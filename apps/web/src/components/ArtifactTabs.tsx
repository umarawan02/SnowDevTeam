"use client";

import { useEffect, useRef, useState } from "react";
import { ARTIFACT_META, ARTIFACT_TAB_ORDER, ROLE_META, durationLabel } from "@/lib/ui";
import type { ArtifactJson, StepJson } from "@/lib/types";
import { Markdown } from "@/components/Markdown";

export function ArtifactTabs({
  artifacts,
  steps,
  running,
  /** When set, this tab is selected first (e.g. the change-plan diff for a
   *  native ticket ready for review). */
  primaryTab,
}: {
  artifacts: ArtifactJson[];
  steps: StepJson[];
  running: boolean;
  primaryTab?: string;
}) {
  const present = ARTIFACT_TAB_ORDER.filter((t) => artifacts.some((a) => a.type === t));
  const initial =
    primaryTab && present.includes(primaryTab as (typeof present)[number])
      ? primaryTab
      : (present[present.length - 1] ?? null);
  const [selected, setSelected] = useState<string | null>(initial);
  const userPicked = useRef(false);
  const prevCount = useRef(present.length);

  /* eslint-disable react-hooks/set-state-in-effect --
     Syncing the selected tab to the incoming `present` list (new artifact
     arrived, or the current tab disappeared) is the intent — not a
     render-phase computation. */
  // While a run is live, follow the newest artifact — unless the user has
  // manually chosen a tab.
  useEffect(() => {
    if (present.length !== prevCount.current) {
      prevCount.current = present.length;
      if (!userPicked.current && present.length > 0) {
        setSelected(present[present.length - 1]);
      }
    }
    if (selected && !present.some((p) => p === selected)) {
      setSelected(present[present.length - 1] ?? null);
    }
  }, [present, selected]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (present.length === 0) {
    return (
      <div className="tabs">
        <span className="waiting">
          {running ? "Waiting for the first artifact…" : "No artifacts."}
        </span>
      </div>
    );
  }

  // Latest of the selected type — a rework loop can produce more than one.
  const active = [...artifacts].reverse().find((a) => a.type === selected);
  const role = active ? ARTIFACT_META[active.type].role : null;
  const step = role ? steps.find((s) => s.role === role) : null;
  const dur = step ? durationLabel(step.startedAt, step.completedAt) : "";

  return (
    <>
      <nav className="tabs" role="tablist" aria-label="Pipeline artifacts">
        {present.map((t) => (
          <button
            key={t}
            className="tab"
            role="tab"
            type="button"
            aria-selected={t === selected}
            onClick={() => {
              userPicked.current = true;
              setSelected(t);
            }}
          >
            {ARTIFACT_META[t].label}
            <span className="who">{ROLE_META[ARTIFACT_META[t].role].label}</span>
          </button>
        ))}
      </nav>

      {active && (
        <div className="artbody" key={active.id}>
          <div className="ahead">
            <span className="agent">{ROLE_META[ARTIFACT_META[active.type].role].label}</span>
            <span className="facts">
              {active.content.length.toLocaleString()} chars{dur ? ` · ${dur}` : ""}
            </span>
          </div>
          {active.type === "CHANGE_PLAN_DIFF" && primaryTab === "CHANGE_PLAN_DIFF" && (
            <p className="hint" style={{ margin: "0 0 10px" }}>
              This is the review surface — approving the ticket applies exactly these changes to a
              dev instance, in one update set.
            </p>
          )}
          <Markdown source={active.content} />
        </div>
      )}
    </>
  );
}
