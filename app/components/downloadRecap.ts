import { formatReplayDuration, shareCardLines, type DayRecap } from "@/lib/dayReplay";
import { formatShare } from "@/lib/lifeBalance";

const W = 1080;
const H = 1350;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawOrbitMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  ctx.save();
  ctx.strokeStyle = "#8E7BFF";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "#5FE3FF";
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.34, -Math.PI / 2, 0);
  ctx.stroke();
  ctx.fillStyle = "#F4F3FA";
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#5FE3FF";
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.34, size * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Aggregate-only recap card: no email, session clocks, or activity names. */
export function downloadDayRecapCard(recap: DayRecap, dateLabel: string): boolean {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#0D0D13");
    bg.addColorStop(0.45, "#07070B");
    bg.addColorStop(1, "#13131B");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W * 0.5, 220, 20, W * 0.5, 280, 520);
    glow.addColorStop(0, "rgba(142,123,255,0.22)");
    glow.addColorStop(1, "rgba(142,123,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, 700);

    drawOrbitMark(ctx, W / 2, 168, 92);

    ctx.fillStyle = "rgba(244,243,250,0.54)";
    ctx.font = "600 28px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("TAPACT  ·  DAY REPLAY", W / 2, 280);

    ctx.fillStyle = "#F4F3FA";
    ctx.font = "600 64px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(dateLabel, W / 2, 360);

    const lines = shareCardLines(recap);
    const cardY = 420;
    const cardH = 220;
    const gap = 24;
    const cardW = (W - 160 - gap * (lines.length - 1)) / lines.length;
    lines.forEach((line, index) => {
      const x = 80 + index * (cardW + gap);
      roundRect(ctx, x, cardY, cardW, cardH, 28);
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "rgba(244,243,250,0.54)";
      ctx.font = "600 22px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(line.label.toUpperCase(), x + cardW / 2, cardY + 70);
      ctx.fillStyle = "#F4F3FA";
      ctx.font = "600 48px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText(line.value, x + cardW / 2, cardY + 150);
    });

    ctx.fillStyle = "rgba(244,243,250,0.54)";
    ctx.font = "600 22px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("LIFE AREAS", 80, 720);

    const barX = 80;
    const barW = W - 160;
    const barY = 752;
    if (recap.areas.length === 0) {
      ctx.fillStyle = "rgba(244,243,250,0.54)";
      ctx.font = "400 28px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText("No tracked time in a life area yet.", barX, barY + 48);
    } else {
      roundRect(ctx, barX, barY, barW, 28, 14);
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fill();
      let cursor = barX;
      recap.areas.forEach((area, index) => {
        const width = Math.max(area.share * barW, index === recap.areas.length - 1 ? 0 : 8);
        roundRect(ctx, cursor, barY, Math.min(width, barX + barW - cursor), 28, 10);
        ctx.fillStyle = area.color;
        ctx.fill();
        cursor += width;
      });

      let row = 820;
      recap.areas.forEach((area) => {
        ctx.fillStyle = area.color;
        ctx.beginPath();
        ctx.arc(barX + 10, row - 8, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#F4F3FA";
        ctx.font = "500 30px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(area.label, barX + 32, row);
        ctx.textAlign = "right";
        ctx.font = "600 30px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.fillText(`${formatReplayDuration(area.ms)}  ${formatShare(area.share)}`, barX + barW, row);
        ctx.textAlign = "left";
        row += 52;
      });
    }

    ctx.fillStyle = "rgba(244,243,250,0.4)";
    ctx.font = "400 24px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Tracked time only  ·  Untracked time isn't included", W / 2, H - 80);

    return canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `tapact-day-${recap.dayKey}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png"), true;
  } catch {
    return false;
  }
}
