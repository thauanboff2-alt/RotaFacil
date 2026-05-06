"use client";

import { UnresolvedLink } from "@/types";

interface FailedLinksProps {
  links: UnresolvedLink[];
}

export default function FailedLinks({ links }: FailedLinksProps) {
  if (links.length === 0) return null;

  return (
    <div className="bg-danger/5 border border-danger/15 rounded-xl p-4 space-y-3 animate-fade-in">
      <div className="flex items-center gap-2">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#c44a4a"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
        <p className="text-sm font-medium text-danger">
          {links.length} {links.length === 1 ? "link não resolvido" : "links não resolvidos"}
        </p>
      </div>
      <div className="space-y-2">
        {links.map((link, i) => (
          <div key={i} className="text-xs space-y-0.5">
            <p className="font-mono text-surface-300/50 truncate">{link.originalLink}</p>
            <p className="text-danger/70">{link.error}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
