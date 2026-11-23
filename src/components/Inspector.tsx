import { cardByKey as db } from "../data/cards";
import { isSentinel, printedShield } from "../engine/rules";
import type { PlayerId } from "../engine/types";
import { useT } from "../i18n/react";
import { fmt } from "../lib/format";

const plain = (s: string) => s.replace(/\*\*/g, "").replace(/^\s*-\s*/, "");

// แสดงข้อความความสามารถภาษาไทย (ช่อง text ของไฟล์การ์ด)
function AbilityText({ text }: { text: string }) {
  const t = useT();
  if (!text) return <p className="mute">{t("insp.noAbility")}</p>;
  return (
    <div className="abil">
      {text.split(/\r?\n/).filter((l) => l.trim()).map((line, i) =>
        line.startsWith("### ") ? <h4 key={i}>{line.slice(4)}</h4>
          : <p key={i} className={/^\s+-/.test(line) ? "eff" : ""}>{plain(line)}</p>)}
    </div>
  );
}

// ครึ่งหนึ่งของแผงขวา: บอทอยู่บน เราอยู่ล่าง ปุ่ม X มุมขวาบนปิดการ์ดที่กำลังดู
export function Inspector({ p, cardKey, power, onClose }: { p: PlayerId; cardKey?: string; power?: number; onClose: () => void }) {
  return (
    <section className={`insp-pane ${p}`}>
      {cardKey && <CardDetail cardKey={cardKey} power={power} />}
      {cardKey && <button className="btn insp-close" onClick={onClose}>×</button>}
    </section>
  );
}

function CardDetail({ cardKey, power }: { cardKey: string; power?: number }) {
  const c = db[cardKey];
  const t = useT();
  const shownPower = power ?? c.power;
  const shield = printedShield(c);
  const stats: [string, string][] = [
    [t("insp.grade"), String(c.grade)],
    [t("insp.power"), shownPower != null ? fmt(shownPower) + (c.powerPlus && power == null ? "+" : "") : "-"],
    [t("insp.race"), c.race],
    [t("insp.shield"), isSentinel(c) ? t("insp.sentinel") : shield ? fmt(shield) : "-"],
  ];
  // ข้างรูป: ประเภท แคลน ชื่อ ค่าพื้นฐาน รหัส / ข้อความความสามารถใช้เต็มความกว้างด้านล่าง
  return (
    <div className="insp">
      <div className="top">
        <div className="big-card">{c.image && <img src={c.image} alt={c.name} />}</div>
        <div className="side-info">
          <span className="type">{t(`type.${c.type}`)}</span>
          <span className="clan">{c.clan}</span>
          <span className="name">{c.name}</span>
          <div className="stats">
            {stats.map(([k, v]) => <div key={k}><span className="k">{k}</span><span className="v">{v}</span></div>)}
          </div>
          <span className="mute mono code">{c.key}</span>
        </div>
      </div>
      <AbilityText text={c.text} />
    </div>
  );
}
