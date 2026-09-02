import { useState } from "react";

interface PuzzleResult {
  score: number;
  correctCount: number;
  totalCount: number;
}

interface ProvincePuzzleProps {
  onComplete: (result: PuzzleResult) => void;
}

interface Province {
  id: string;
  name: string;
  region: string;
}

interface Slot {
  id: string;
  region: string;
}

const provinces: Province[] = [
  { id: "heilongjiang", name: "黑龙江省", region: "东北" },
  { id: "jilin", name: "吉林省", region: "东北" },
  { id: "hebei", name: "河北省", region: "华北" },
  { id: "shanxi", name: "山西省", region: "华北" },
  { id: "sichuan", name: "四川省", region: "西南" },
  { id: "yunnan", name: "云南省", region: "西南" }
];

const slots: Slot[] = [
  { id: "slot-ne-1", region: "东北" },
  { id: "slot-ne-2", region: "东北" },
  { id: "slot-n-1", region: "华北" },
  { id: "slot-n-2", region: "华北" },
  { id: "slot-sw-1", region: "西南" },
  { id: "slot-sw-2", region: "西南" }
];

export default function ProvincePuzzle({ onComplete }: ProvincePuzzleProps) {
  const [selectedProvince, setSelectedProvince] = useState<string | null>(null);
  const [filled, setFilled] = useState<Record<string, string>>({});
  const [wrongSlot, setWrongSlot] = useState<string | null>(null);
  const [message, setMessage] = useState("先选择一个省份，再点击对应的区域格子");

  const usedProvinceIds = new Set(Object.values(filled));

  function handleProvinceClick(provinceId: string) {
    if (usedProvinceIds.has(provinceId)) {
      return;
    }
    setSelectedProvince(provinceId);
    setWrongSlot(null);
    setMessage(`已选择：${provinces.find((p) => p.id === provinceId)?.name}`);
  }

  function handleSlotClick(slot: Slot) {
    if (!selectedProvince || filled[slot.id]) {
      return;
    }

    const province = provinces.find((p) => p.id === selectedProvince);
    if (!province) {
      return;
    }

    if (province.region !== slot.region) {
      setWrongSlot(slot.id);
      setMessage(`${province.name}不属于${slot.region}，再试一次`);
      window.setTimeout(() => setWrongSlot(null), 600);
      return;
    }

    const nextFilled = {
      ...filled,
      [slot.id]: province.id
    };
    setFilled(nextFilled);
    setSelectedProvince(null);
    setMessage(`${province.name}放置成功`);

    if (Object.keys(nextFilled).length === slots.length) {
      const correctCount = Object.values(nextFilled).filter(
        (provinceId) =>
          provinces.find((p) => p.id === provinceId)?.region ===
          slots.find((s) => nextFilled[s.id] === provinceId)?.region
      ).length;

      window.setTimeout(() => {
        onComplete({
          score: correctCount * 10,
          correctCount,
          totalCount: slots.length
        });
      }, 500);
    }
  }

  return (
    <section className="puzzle">
      <h2>行政区拼图</h2>
      <p className="puzzle-message">{message}</p>

      <div className="province-list">
        {provinces.map((province) => {
          const used = usedProvinceIds.has(province.id);
          const selected = selectedProvince === province.id;
          return (
            <button
              key={province.id}
              className={`province ${selected ? "selected" : ""}`}
              disabled={used}
              onClick={() => handleProvinceClick(province.id)}
            >
              {used ? "已放置" : province.name}
            </button>
          );
        })}
      </div>

      <div className="slot-grid">
        {slots.map((slot) => {
          const provinceId = filled[slot.id];
          const province = provinces.find((p) => p.id === provinceId);
          const className = [
            "slot",
            province ? "filled" : "",
            wrongSlot === slot.id ? "wrong" : ""
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <button
              key={slot.id}
              className={className}
              disabled={Boolean(province)}
              onClick={() => handleSlotClick(slot)}
            >
              <span className="region">{slot.region}</span>
              <span className="province-name">{province?.name ?? "点击放置"}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

