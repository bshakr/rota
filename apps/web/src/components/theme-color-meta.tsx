"use client";

import * as React from "react";
import { useTheme } from "next-themes";

// The single <meta name="theme-color"> that tints the phone's browser chrome, at
// runtime, from the theme the user actually resolved to.
//
// The static media-query tags Next can emit track the OS preference, not the
// app's choice, so a user who picks Light on a dark phone gets a cocoa bar above
// a sand page. next-themes knows the resolved theme; this keeps the meta in sync
// with it. Renders no DOM — it owns the tag imperatively so there is exactly one.
//
// These two values MUST track --background in globals.css (sunbeam-100 /
// twilight-950); a <meta> is read before any CSS exists, so it cannot reference
// the token — the one sanctioned place for a raw colour, so the lint rule is
// disabled for it.
// eslint-disable-next-line no-restricted-syntax
const COLORS = { light: "#fbf7eb", dark: "#181428" } as const;

export function ThemeColorMeta() {
  const { resolvedTheme } = useTheme();

  React.useEffect(() => {
    const color = COLORS[resolvedTheme === "dark" ? "dark" : "light"];
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", color);
  }, [resolvedTheme]);

  return null;
}
