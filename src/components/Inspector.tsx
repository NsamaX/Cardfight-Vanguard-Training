import { cardByKey as db } from "../data/cards";
import { isOptional } from "../engine/abilities";
import { isSentinel, printedShield } from "../engine/rules";
import type { Ability, PlayerId } from "../engine/types";
import { useT } from "../i18n/react";
import { fmt } from "../lib/format";
import { blocksFromCodes, parseBlocks } from "../lib/skillBlocks";

// ความสามารถแต่ละอันเป็นกล่อง: หัวกล่องบอกประเภท (AUTO แยกบังคับ/เลือกใช้) และช่อง ข้างล่างคือเงื่อนไข จังหวะ คอสต์ และผล
export function SkillBlocks({ text, abilities }: { text: string; abilities: Ability[] }) {
  const t = useT();
  const parsed = parseBlocks(text, abilities);
  const coded = !parsed.length;
  const blocks = coded ? blocksFromCodes(abilities) : parsed;
  if (!blocks.length && !text.trim()) return <p className="mute">{t("insp.noAbility")}</p>;
  return (
    <div className={`abil ${coded ? "coded" : ""}`}>
      {coded && text.trim().split(/\r?\n/).filter((l) => l.trim()).map((l, i) => <p key={i}>{plain(l)}</p>)}
      {blocks.map((b, i) => (
        <div key={i} className={`skill ${b.kind === "AUTO" && b.ability && !isOptional(b.ability) ? "forced" : ""}`}>
          <div className="skill-head">
            <span className="kind">{b.kind}</span>
            {b.kind === "AUTO" && b.ability && <span className="sub">{t(isOptional(b.ability) ? "skill.optional" : "skill.forced")}</span>}
            {b.zone && <span className="zone">{b.zone}</span>}
          </div>
          {(["cond", "timing", "cost"] as const).map((f) => b[f] && (
            <p key={f} className="field"><span className="k">{t(`skill.${f}`)}</span>{plain(b[f]!)}</p>
          ))}
          {b.effect && <p className="eff">{plain(b.effect)}</p>}
        </div>
      ))}
    </div>
  );
}

const plain = (s: string) => s.replace(/\*\*/g, "");

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
      <SkillBlocks text={c.text} abilities={c.abilities} />
    </div>
  );
}
