"use client";

import ReactDOM from "react-dom";
import { BACKINGS_URL, FACES_URL } from "@/domain/sprites";

export function PreloadResources() {
  ReactDOM.preload(FACES_URL, { as: "image", fetchPriority: "high" });
  ReactDOM.preload(BACKINGS_URL, { as: "image", fetchPriority: "high" });
  return null;
}
