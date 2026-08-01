type PriceListOgImageProps = {
  eyebrow: string;
  title: string;
  description: string;
  accent: string;
  soft: string;
};

export function PriceListOgImage({
  eyebrow,
  title,
  description,
  accent,
  soft,
}: PriceListOgImageProps) {
  return (
    <div
      style={{
        alignItems: "stretch",
        background: "#ffffff",
        color: "#14344d",
        display: "flex",
        flexDirection: "column",
        fontFamily: "Arial, sans-serif",
        height: "100%",
        padding: "64px 72px",
        position: "relative",
        width: "100%",
      }}
    >
      <div style={{ background: accent, height: "16px", left: 0, position: "absolute", top: 0, width: "100%" }} />
      <div style={{ background: soft, borderRadius: "999px", color: accent, display: "flex", fontSize: "24px", fontWeight: 700, padding: "12px 22px", width: "fit-content" }}>
        {eyebrow}
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: "36px" }}>
        <div style={{ fontSize: "64px", fontWeight: 800, letterSpacing: "-2px", lineHeight: 1.08, maxWidth: "900px" }}>
          {title}
        </div>
        <div style={{ color: "#526675", fontSize: "30px", lineHeight: 1.35, marginTop: "30px", maxWidth: "920px" }}>
          {description}
        </div>
      </div>
      <div style={{ alignItems: "center", borderTop: "2px solid #dbe5ed", display: "flex", fontSize: "24px", fontWeight: 700, marginTop: "auto", paddingTop: "28px" }}>
        HẢI ĐĂNG TECH
      </div>
    </div>
  );
}
