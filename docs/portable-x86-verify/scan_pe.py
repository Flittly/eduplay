#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""扫描目录下所有 PE 文件（.exe/.dll/.sys），报告机器架构与头损坏。
用法: python scan_pe.py <目录> [--all]
  --all  连 .node/.ocx 等扩展名也扫（默认只扫 exe/dll）
输出: 每个文件一行  ARCH  SIZE  MZ/PE状态  路径
"""
import os
import struct
import sys

MACHINE = {
    0x014C: "x86(i386)",
    0x0200: "IA64",
    0x8664: "x64(AMD64)",
    0xAA64: "ARM64",
    0x01C4: "ARMv7",
    0x01C0: "ARM",
}


def pe_info(path):
    """返回 (machine_str, status_str)"""
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            head = f.read(0x1000)
            if len(head) < 0x40:
                return "?", "TRUNCATED(<64B, 无MZ)"
            if head[:2] != b"MZ":
                # 可能是 ELF/Mach-O/脚本
                if head[:4] == b"\x7fELF":
                    return "?", "NOT-PE(是ELF)"
                if head[:4] in (b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xca\xfe\xba\xbe"):
                    return "?", "NOT-PE(是Mach-O)"
                return "?", "NOT-PE(无MZ头)"
            e_lfanew = struct.unpack_from("<I", head, 0x3C)[0]
            if e_lfanew + 6 > size:
                return "?", "BAD(PE偏移越界 e_lfanew=0x%X > size=%d)" % (e_lfanew, size)
            f.seek(e_lfanew)
            sig = f.read(4)
            if sig != b"PE\0\0":
                return "?", "BAD(PE签名错: %r)" % sig
            machine = struct.unpack("<H", f.read(2))[0]
            coff_chars = struct.unpack("<H", f.read(2))[0]  # skip NumberOfSections pairing
            f.seek(e_lfanew + 4 + 20)
            opt_magic = struct.unpack("<H", f.read(2))[0]  # 0x10B=PE32, 0x20B=PE32+
            f.seek(e_lfanew + 4 + 20 + 56)  # SizeOfHeaders 在 optional header 偏移 56 处是错的，改为读 section 表尾
            # 简化：用 SizeOfImage / 文件大小做截断粗检
            f.seek(e_lfanew + 4 + 20)
            opt = f.read(240 if opt_magic == 0x20B else 224)
            if len(opt) >= 60:
                size_of_image = struct.unpack_from("<I", opt, 56)[0]
                size_of_headers = struct.unpack_from("<I", opt, 60)[0]
                if size > 200 and size < size_of_headers:
                    return MACHINE.get(machine, hex(machine)), "TRUNCATED(size=%d < SizeOfHeaders=%d)" % (size, size_of_headers)
            fmt = {0x10B: "PE32", 0x20B: "PE32+"}.get(opt_magic, "PE?")
            arch = MACHINE.get(machine, hex(machine))
            if machine == 0x8664 and opt_magic == 0x10B:
                arch += "/WOW64装PE32"
            return arch, "OK(%s)" % fmt
    except OSError as e:
        return "?", "READ-ERR(%s)" % e
    except Exception as e:  # noqa: BLE001
        return "?", "PARSE-ERR(%s)" % e


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    scan_all = "--all" in sys.argv
    if not args:
        print(__doc__)
        sys.exit(1)
    root = args[0]
    exts = {".exe", ".dll", ".sys", ".node", ".ocx", ".cpl", ".efi"} if scan_all else {".exe", ".dll"}
    counts = {}
    rows = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d.lower() not in ("locales",)]  # locales 里没有 PE
        for name in filenames:
            if os.path.splitext(name)[1].lower() not in exts:
                continue
            p = os.path.join(dirpath, name)
            arch, status = pe_info(p)
            rel = os.path.relpath(p, root)
            rows.append((arch, status, os.path.getsize(p), rel))
            key = arch if status.startswith("OK") else status.split("(")[0]
            counts[key] = counts.get(key, 0) + 1

    rows.sort()
    for arch, status, size, rel in rows:
        flag = "" if status.startswith("OK") else "  <<<<< 异常"
        print("%-12s %10d  %-40s  %s%s" % (arch, size, status, rel, flag))
    print("\n=== 汇总 ===")
    for k, v in sorted(counts.items(), key=lambda x: -x[1]):
        print("  %-14s %d 个" % (k, v))
    bad = [r for r in rows if not r[1].startswith("OK")]
    print("异常文件: %d / %d" % (len(bad), len(rows)))
    # 架构一致性
    archs = {r[0] for r in rows if r[1].startswith("OK")}
    if len(archs) > 1:
        print("!!! 架构混装: %s" % ", ".join(sorted(archs)))
    else:
        print("架构单一: %s" % (archs or "无"))


if __name__ == "__main__":
    main()
