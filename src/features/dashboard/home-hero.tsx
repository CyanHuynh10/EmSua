import { CalendarClock, PawPrint, Sparkles } from "lucide-react";
import { TIME_ZONE } from "../model";
import styles from "./view.module.css";

export function HomeHero({ serverTime }: { serverTime?: string }) {
  const dayLabel = serverTime ? new Intl.DateTimeFormat("vi-VN", {
    timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long",
  }).format(new Date(serverTime)) : null;

  return <section className={styles.hero}>
    <div className={styles.heroCopy}>
      <div className={styles.heroLabel}><PawPrint size={16} /> SỮA SMART HOME</div>
      <h1>Nhà của Sữa</h1>
      <p>Cho ăn, điều chỉnh đèn và kiểm tra camera từ một nơi.</p>
      <div className={styles.heroMeta}>
        <span className={`${styles.pill} ${styles.yellow}`}>Mock Mode</span>
        {dayLabel && <span><CalendarClock size={17} /> {dayLabel}</span>}
      </div>
    </div>
    <div className={styles.heroArt} aria-hidden="true">
      <Sparkles className={styles.star1} size={38} />
      <span><PawPrint size={74} strokeWidth={1.75} /></span>
      <Sparkles className={styles.star2} size={26} />
    </div>
  </section>;
}
