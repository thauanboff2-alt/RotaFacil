"use client";

import { AppStep } from "@/types";

const steps: { key: AppStep | "resolving" | "optimizing"; label: string }[] = [
  { key: "input", label: "Colar links" },
  { key: "resolved", label: "Validar" },
  { key: "optimized", label: "Otimizar" },
];

interface StepIndicatorProps {
  currentStep: AppStep;
}

export default function StepIndicator({ currentStep }: StepIndicatorProps) {
  const stepOrder: AppStep[] = ["input", "resolving", "resolved", "optimizing", "optimized"];
  const currentIndex = stepOrder.indexOf(currentStep);

  const getStepState = (key: string) => {
    const displaySteps: Record<string, number> = {
      input: 0,
      resolved: 1,
      optimized: 2,
    };
    const stepIdx = displaySteps[key] ?? 0;

    // Map current step to display index
    let currentDisplay = 0;
    if (currentIndex >= 2) currentDisplay = 1; // resolved or optimizing
    if (currentIndex >= 4) currentDisplay = 2; // optimized

    if (stepIdx < currentDisplay) return "done";
    if (stepIdx === currentDisplay) return "active";
    return "pending";
  };

  return (
    <div className="flex items-center justify-center gap-1 py-2">
      {steps.map((step, i) => {
        const state = getStepState(step.key);
        return (
          <div key={step.key} className="flex items-center gap-1">
            <div className="flex items-center gap-1.5">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-300 ${
                  state === "done"
                    ? "bg-accent/20 text-accent"
                    : state === "active"
                    ? "bg-accent text-surface-950"
                    : "bg-surface-800/60 text-surface-300/40"
                }`}
              >
                {state === "done" ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`text-xs font-medium transition-colors duration-300 ${
                  state === "active"
                    ? "text-accent"
                    : state === "done"
                    ? "text-surface-300/60"
                    : "text-surface-300/30"
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`w-8 h-px mx-1 transition-colors duration-300 ${
                  state === "done" ? "bg-accent/30" : "bg-surface-800/60"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
