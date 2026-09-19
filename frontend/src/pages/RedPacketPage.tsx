import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, Plus, RotateCcw, SlidersHorizontal, Trash2 } from "lucide-react";
import { useTranslation } from "../i18n";

/** 奖品设置单独存在本机：老师配一次，之后每节课直接用，不必重复录入。 */
const PRIZE_STORAGE_KEY = "eduplay.redpacket.prizes";
const MAX_PACKETS = 200;
const MAX_COUNT_PER_ROW = 99;
/** 「刚开出的那个红包」高亮多久。 */
const FRESH_MS = 900;

interface PrizeRow {
  id: string;
  name: string;
  count: number;
}

interface Packet {
  /** 红包编号，1 起。翻开前后都显示，方便老师喊「第 7 号」。 */
  no: number;
  /** null = 谢谢参与。 */
  prize: string | null;
  opened: boolean;
}

interface Latest {
  no: number;
  prize: string | null;
}

let rowSeq = 0;

function newRow(name = "", count = 1): PrizeRow {
  rowSeq += 1;
  return { id: `rp-row-${rowSeq}`, name, count };
}

function clampCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(MAX_COUNT_PER_ROW, Math.max(1, Math.trunc(value)));
}

function createDefaultRows(): PrizeRow[] {
  return [newRow(), newRow(), newRow()];
}

function readStoredRows(): PrizeRow[] {
  try {
    const raw = window.localStorage.getItem(PRIZE_STORAGE_KEY);
    if (!raw) {
      return createDefaultRows();
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return createDefaultRows();
    }
    const rows = parsed
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null
      )
      .map((item) =>
        newRow(
          typeof item.name === "string" ? item.name : "",
          clampCount(Number(item.count))
        )
      );
    return rows.length > 0 ? rows : createDefaultRows();
  } catch {
    return createDefaultRows();
  }
}

/** Fisher-Yates 洗牌：保证先点后点中奖概率一致。 */
function shuffle<T>(items: T[]): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

/**
 * 生成红包。奖品在**生成时**就已定位（而不是点开时才随机），原因有三：
 * 1. 「还剩几份奖」是真实数字，学生看得见；
 * 2. 先点后点概率一样，公平性可解释；
 * 3. 一轮结束能逐个核对谁中了什么。
 */
function dealPackets(prizes: string[], total: number): Packet[] {
  const slots: (string | null)[] = prizes.slice();
  while (slots.length < total) {
    slots.push(null);
  }
  return shuffle(slots).map((prize, index) => ({
    no: index + 1,
    prize,
    opened: false
  }));
}

export default function RedPacketPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PrizeRow[]>(readStoredRows);
  /** null = 红包总数自动跟随奖品份数；一旦老师手填，就以手填值为准。 */
  const [packetOverride, setPacketOverride] = useState<number | null>(null);
  /** null = 还在设置阶段。 */
  const [packets, setPackets] = useState<Packet[] | null>(null);
  const [latest, setLatest] = useState<Latest | null>(null);
  const [freshNo, setFreshNo] = useState<number | null>(null);
  const [error, setError] = useState("");
  const freshTimer = useRef<number | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        PRIZE_STORAGE_KEY,
        JSON.stringify(
          rows.map((row) => ({ name: row.name, count: row.count }))
        )
      );
    } catch {
      /* 无痕模式或配额已满：不影响抽奖，静默跳过 */
    }
  }, [rows]);

  useEffect(() => {
    return () => {
      if (freshTimer.current !== null) {
        window.clearTimeout(freshTimer.current);
      }
    };
  }, []);

  /** 奖品一改动就撤下上次的错误提示，否则「已经填好了红框还挂着」很困惑。 */
  useEffect(() => {
    setError("");
  }, [rows]);

  const totalPrizes = useMemo(
    () =>
      rows.reduce((sum, row) => sum + (row.name.trim() ? row.count : 0), 0),
    [rows]
  );
  const packetTotal = Math.max(packetOverride ?? totalPrizes, totalPrizes, 1);

  const openedCount = packets
    ? packets.filter((packet) => packet.opened).length
    : 0;
  const remainingPrizes = packets
    ? packets.filter((packet) => !packet.opened && packet.prize !== null).length
    : 0;
  const allOpened =
    packets !== null && packets.length > 0 && openedCount === packets.length;

  function updateRow(id: string, patch: Partial<PrizeRow>) {
    setRows((previous) =>
      previous.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  }

  function addRow() {
    setRows((previous) => [...previous, newRow()]);
  }

  function removeRow(id: string) {
    setRows((previous) =>
      previous.length <= 1
        ? previous
        : previous.filter((row) => row.id !== id)
    );
  }

  /** 把「奖品名 + 份数」展开成一份一份的奖品名。空行忽略。 */
  function collectPrizes(): string[] {
    const names: string[] = [];
    for (const row of rows) {
      const name = row.name.trim();
      if (!name) {
        continue;
      }
      for (let i = 0; i < row.count; i += 1) {
        names.push(name);
      }
    }
    return names;
  }

  function markFresh(no: number) {
    if (freshTimer.current !== null) {
      window.clearTimeout(freshTimer.current);
    }
    setFreshNo(no);
    freshTimer.current = window.setTimeout(() => {
      setFreshNo(null);
      freshTimer.current = null;
    }, FRESH_MS);
  }

  function startDraw() {
    const names = collectPrizes();
    if (names.length === 0) {
      setError("请至少填写一个奖品名称");
      return;
    }
    setError("");
    setPackets(dealPackets(names, packetTotal));
    setLatest(null);
    setFreshNo(null);
  }

  function openPacket(no: number) {
    if (!packets) {
      return;
    }
    const target = packets.find((packet) => packet.no === no);
    if (!target || target.opened) {
      return;
    }
    setPackets((previous) =>
      previous
        ? previous.map((packet) =>
            packet.no === no ? { ...packet, opened: true } : packet
          )
        : previous
    );
    setLatest({ no, prize: target.prize });
    markFresh(no);
  }

  function revealAll() {
    setPackets((previous) =>
      previous
        ? previous.map((packet) =>
            packet.opened ? packet : { ...packet, opened: true }
          )
        : previous
    );
    setLatest(null);
    setFreshNo(null);
  }

  function reshuffle() {
    const names = collectPrizes();
    if (names.length === 0) {
      return;
    }
    setPackets(dealPackets(names, packetTotal));
    setLatest(null);
    setFreshNo(null);
  }

  function backToSetup() {
    setPackets(null);
    setLatest(null);
    setFreshNo(null);
    setError("");
  }

  function renderSetup() {
    return (
      <>
        <section className="panel rp-setup">
          <div className="rp-setup-head">
            <h2>奖品设置</h2>
            <p>
              每行填一个奖品和它的份数。比如「笔记本」填 3 份，就会生成 3
              个装着笔记本的红包。
            </p>
          </div>

          <div className="rp-prize-list">
            {rows.map((row, index) => (
              <div className="rp-prize-row" key={row.id}>
                <span className="rp-prize-index">{index + 1}</span>
                <input
                  className="rp-prize-name"
                  type="text"
                  value={row.name}
                  maxLength={20}
                  placeholder="奖品名称，例如：笔记本"
                  aria-label={`第 ${index + 1} 行奖品名称`}
                  onChange={(event) =>
                    updateRow(row.id, { name: event.target.value })
                  }
                />
                <label className="rp-prize-count">
                  <input
                    type="number"
                    min={1}
                    max={MAX_COUNT_PER_ROW}
                    value={row.count}
                    aria-label={`第 ${index + 1} 行奖品份数`}
                    onChange={(event) =>
                      updateRow(row.id, {
                        count: clampCount(Number(event.target.value))
                      })
                    }
                  />
                  <span>份</span>
                </label>
                <button
                  className="rp-prize-remove"
                  type="button"
                  title="删除这一行"
                  aria-label={`删除第 ${index + 1} 行奖品`}
                  disabled={rows.length <= 1}
                  onClick={() => removeRow(row.id)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>

          <button className="secondary rp-add-row" type="button" onClick={addRow}>
            <Plus size={16} />
            添加奖品
          </button>

          <div className="rp-total-row">
            <label className="rp-total-label" htmlFor="rp-total-input">
              红包总数
            </label>
            <input
              id="rp-total-input"
              className="rp-total-input"
              type="number"
              min={Math.max(totalPrizes, 1)}
              max={MAX_PACKETS}
              value={packetTotal}
              onChange={(event) => {
                const next = Number(event.target.value);
                setPacketOverride(
                  Number.isFinite(next)
                    ? Math.min(
                        MAX_PACKETS,
                        Math.max(totalPrizes, Math.trunc(next))
                      )
                    : null
                );
              }}
            />
            <p className="rp-total-tip">
              {totalPrizes === 0
                ? "先填上奖品，红包数量会自动跟着奖品份数走"
                : packetTotal > totalPrizes
                  ? `奖品共 ${totalPrizes} 份，另有 ${packetTotal - totalPrizes} 个「谢谢参与」`
                  : `奖品共 ${totalPrizes} 份，每个红包都有奖`}
            </p>
          </div>
        </section>

        {error && <div className="error">{error}</div>}

        <div className="rp-start">
          <button className="pick-go" type="button" onClick={startDraw}>
            生成红包
          </button>
        </div>
      </>
    );
  }

  function renderBoard() {
    const list = packets ?? [];
    return (
      <>
        <div
          className={`rp-latest${latest ? "" : " rp-latest-idle"}${
            latest && latest.prize === null ? " rp-latest-blank" : ""
          }`}
          aria-live="polite"
        >
          {latest ? (
            <>
              <span className="rp-latest-no">第 {latest.no} 号红包</span>
              <strong className="rp-latest-prize">
                {latest.prize ?? "谢谢参与"}
              </strong>
            </>
          ) : (
            <span className="rp-latest-hint">
              {allOpened ? "本轮红包已全部开启" : "点击任意一个红包开奖"}
            </span>
          )}
        </div>

        <section className="rp-board" aria-label="红包列表">
          {list.map((packet) => (
            <button
              key={packet.no}
              type="button"
              className={`rp-packet${packet.opened ? " is-open" : ""}${
                packet.opened && packet.prize === null ? " is-blank" : ""
              }${freshNo === packet.no ? " is-fresh" : ""}`}
              disabled={packet.opened}
              onClick={() => openPacket(packet.no)}
              aria-label={
                packet.opened
                  ? `第 ${packet.no} 号红包已开：${packet.prize ?? "谢谢参与"}`
                  : `打开第 ${packet.no} 号红包`
              }
            >
              <span className="rp-packet-inner">
                <span className="rp-packet-face rp-packet-front">
                  <span className="rp-packet-seal" aria-hidden="true" />
                  <span className="rp-packet-no">{packet.no}</span>
                </span>
                <span className="rp-packet-face rp-packet-back">
                  <span className="rp-packet-prize">
                    {packet.prize ?? "谢谢参与"}
                  </span>
                </span>
              </span>
            </button>
          ))}
        </section>

        <div className="rp-actions">
          <button
            className="secondary"
            type="button"
            onClick={revealAll}
            disabled={allOpened}
          >
            <Eye size={16} />
            揭晓全部
          </button>
          <button className="secondary" type="button" onClick={reshuffle}>
            <RotateCcw size={16} />
            重新洗牌
          </button>
          <button className="secondary" type="button" onClick={backToSetup}>
            <SlidersHorizontal size={16} />
            修改奖品
          </button>
        </div>

        <p className="rp-board-tip">
          剩余奖品 {remainingPrizes} 份 · 已开 {openedCount} / {list.length}
        </p>
      </>
    );
  }

  return (
    <div className="page-content">
      <header className="page-header">
        <div>
          <p className="page-kicker">{t("pages.redpacket.kicker")}</p>
          <h1>{t("pages.redpacket.title")}</h1>
          <p>{t("pages.redpacket.subtitle")}</p>
        </div>
        <div className="points-card">
          {packets ? (
            <>
              <span>已开红包</span>
              <strong>
                {openedCount} / {packets.length}
              </strong>
            </>
          ) : (
            <>
              <span>奖品份数</span>
              <strong>{totalPrizes}</strong>
            </>
          )}
        </div>
      </header>

      {packets === null ? renderSetup() : renderBoard()}

      <div className="page-footer-actions">
        <Link className="secondary button-link" to="/tools">
          返回工具箱
        </Link>
      </div>
    </div>
  );
}
