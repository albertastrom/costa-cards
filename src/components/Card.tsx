"use client";

import { memo, type CSSProperties } from "react";
import type { CardBackId, CardView } from "@/lib/types";
import {
  BACKINGS_SHEET,
  BACKINGS_URL,
  FACES_SHEET,
  FACES_URL,
  FACE_BASE_RECT,
  JOKER_MARK_RECT,
  backRect,
  faceRect,
  isJoker,
  spokenCardName,
  type SpriteRect,
} from "@/domain/sprites";

function layer(
  url: string,
  sheet: { w: number; h: number },
  rect: SpriteRect,
  w: number,
  h: number,
  extra?: CSSProperties,
) {
  const sx = w / rect.w;
  const sy = h / rect.h;
  return (
    <div
      aria-hidden
      className="sprite absolute inset-0"
      style={{
        backgroundImage: `url(${url})`,
        backgroundPosition: `${-rect.x * sx}px ${-rect.y * sy}px`,
        backgroundSize: `${sheet.w * sx}px ${sheet.h * sy}px`,
        ...extra,
      }}
    />
  );
}

type CardFaceProps = {
  card: Pick<CardView, "faceUp" | "rank" | "suit">;
  back: CardBackId;
  w: number;
  h: number;
  /** Force the back even if the face is known (shield mode). */
  concealed?: boolean;
  className?: string;
  style?: CSSProperties;
};

/** Pure sprite rendering of one card (no interaction). */
export const CardFace = memo(function CardFace({
  card,
  back,
  w,
  h,
  concealed,
  className = "",
  style,
}: CardFaceProps) {
  const showFace = card.faceUp && !!card.rank && !!card.suit && !concealed;
  const joker = showFace && isJoker(card.rank, card.suit);
  const rect = showFace && !joker ? faceRect(card.rank!, card.suit!) : null;

  return (
    <div
      role="img"
      aria-label={showFace ? spokenCardName(card.rank, card.suit) : "Face-down card"}
      className={`card-face relative ${className}`}
      style={{ width: w, height: h, ...style }}
    >
      {/* key on visibility so a reveal replays the flip animation */}
      <div key={showFace ? "f" : "b"} className="card-flip absolute inset-0">
        {showFace ? (
          <>
            {layer(BACKINGS_URL, BACKINGS_SHEET, FACE_BASE_RECT, w, h)}
            {rect && layer(FACES_URL, FACES_SHEET, rect, w, h)}
            {joker && (
              <>
                {layer(BACKINGS_URL, BACKINGS_SHEET, JOKER_MARK_RECT, w, h, {
                  filter: "brightness(0.55) sepia(1) saturate(6) hue-rotate(250deg)",
                })}
                <span
                  className="absolute left-0 right-0 text-center font-black tracking-tight text-[#7a2fb8]"
                  style={{ top: h * 0.06, fontSize: Math.max(7, Math.round(w * 0.16)), lineHeight: 1 }}
                >
                  JOKER
                </span>
              </>
            )}
          </>
        ) : (
          layer(BACKINGS_URL, BACKINGS_SHEET, backRect(back), w, h)
        )}
      </div>
    </div>
  );
});
