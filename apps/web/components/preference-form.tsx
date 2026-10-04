"use client";

import { useState } from "react";
import { Button } from "@moviewatch/ui";
import {
  DAY_LABELS,
  FORMAT_OPTIONS,
  ROW_OPTIONS,
  TIME_WINDOW_PRESETS,
  ZONE_OPTIONS,
  type PreferenceInput,
} from "@/lib/watches";

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
        selected
          ? "bg-gold text-black"
          : "border border-white/10 bg-surface text-muted hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <div>
      <span className="text-sm text-muted">{label}</span>
      <div className="mt-1 flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-lg disabled:opacity-30"
          aria-label={`Decrease ${label}`}
        >
          −
        </button>
        <span className="w-8 text-center text-lg font-semibold">{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-lg disabled:opacity-30"
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3"
    >
      <span
        className={`relative h-6 w-11 rounded-full transition-colors ${
          checked ? "bg-gold" : "bg-white/15"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </span>
      <span className="text-sm">{label}</span>
    </button>
  );
}

const CUSTOM_WINDOW_RE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

export function PreferenceForm({
  value,
  onChange,
  title,
}: {
  value: PreferenceInput;
  onChange: (v: PreferenceInput) => void;
  title: string;
}) {
  const [theaterText, setTheaterText] = useState(value.theaterIds.join(", "));
  const [customWindow, setCustomWindow] = useState("");
  const [customError, setCustomError] = useState("");

  const set = <K extends keyof PreferenceInput>(k: K, v: PreferenceInput[K]) =>
    onChange({ ...value, [k]: v });
  const setSeat = (k: keyof PreferenceInput["seatRules"], v: number | string | boolean) =>
    onChange({ ...value, seatRules: { ...value.seatRules, [k]: v } });

  const toggleIn = (arr: string[], item: string) =>
    arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];

  const addCustomWindow = () => {
    const w = customWindow.trim();
    if (!CUSTOM_WINDOW_RE.test(w)) {
      setCustomError("Use HH:MM-HH:MM, e.g. 19:30-22:00.");
      return;
    }
    const [start, end] = w.split("-");
    if (!start || !end || start >= end) {
      setCustomError("Start time must be before end time.");
      return;
    }
    if (value.timeWindows.includes(w)) {
      setCustomError("That window is already added.");
      return;
    }
    set("timeWindows", [...value.timeWindows, w]);
    setCustomWindow("");
    setCustomError("");
  };

  const customWindows = value.timeWindows.filter(
    (w) => !(TIME_WINDOW_PRESETS as readonly string[]).includes(w),
  );

  return (
    <div className="space-y-8">
      <h3 className="text-xl font-semibold">{title}</h3>

      {/* Theaters */}
      <div>
        <label htmlFor="theaters" className="mb-2 block text-sm font-medium">
          Theaters <span className="text-muted">(comma-separated)</span>
        </label>
        <input
          id="theaters"
          value={theaterText}
          onChange={(e) => {
            setTheaterText(e.target.value);
            set(
              "theaterIds",
              e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
            );
          }}
          placeholder="Cinemark Frisco, AMC Stonebriar"
          className="w-full rounded-xl border border-white/10 bg-surface px-4 py-2.5 text-sm outline-none placeholder:text-muted focus:border-gold/50"
        />
        <p className="mt-1 text-xs text-muted">
          The theater directory arrives in Milestone 5 — for now, type theater names.
        </p>
      </div>

      {/* Days of week */}
      <div>
        <p className="mb-2 text-sm font-medium">
          Days <span className="text-muted">(leave empty for any day)</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {DAY_LABELS.map((label, i) => (
            <Chip
              key={label}
              selected={value.daysOfWeek.includes(i)}
              onClick={() =>
                set(
                  "daysOfWeek",
                  value.daysOfWeek.includes(i)
                    ? value.daysOfWeek.filter((d) => d !== i)
                    : [...value.daysOfWeek, i].sort(),
                )
              }
            >
              {label}
            </Chip>
          ))}
        </div>
      </div>

      {/* Time windows */}
      <div>
        <p className="mb-2 text-sm font-medium">Showtime windows</p>
        <div className="flex flex-wrap gap-2">
          {TIME_WINDOW_PRESETS.map((w) => (
            <Chip
              key={w}
              selected={value.timeWindows.includes(w)}
              onClick={() => set("timeWindows", toggleIn(value.timeWindows, w))}
            >
              {w}
            </Chip>
          ))}
          {customWindows.map((w) => (
            <span
              key={w}
              className="inline-flex items-center gap-1 rounded-full bg-gold px-3 py-1.5 text-sm font-medium text-black"
            >
              {w}
              <button
                type="button"
                onClick={() => set("timeWindows", toggleIn(value.timeWindows, w))}
                aria-label={`Remove ${w}`}
                className="ml-1 font-bold"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="mt-3 flex max-w-sm items-center gap-2">
          <input
            value={customWindow}
            onChange={(e) => {
              setCustomWindow(e.target.value);
              setCustomError("");
            }}
            placeholder="Custom: 19:30-22:00"
            className="w-full rounded-xl border border-white/10 bg-surface px-4 py-2 text-sm outline-none placeholder:text-muted focus:border-gold/50"
          />
          <Button type="button" variant="ghost" size="sm" onClick={addCustomWindow}>
            Add
          </Button>
        </div>
        {customError && <p className="mt-1 text-xs text-red-400">{customError}</p>}
      </div>

      {/* Formats */}
      <div>
        <p className="mb-2 text-sm font-medium">Formats</p>
        <div className="flex flex-wrap gap-2">
          {FORMAT_OPTIONS.map((f) => (
            <Chip
              key={f}
              selected={value.formats.includes(f)}
              onClick={() => set("formats", toggleIn(value.formats, f))}
            >
              {f}
            </Chip>
          ))}
        </div>
      </div>

      {/* Tickets + price */}
      <div className="flex flex-wrap gap-10">
        <Stepper
          label="Tickets"
          value={value.ticketCount}
          min={1}
          max={10}
          onChange={(v) => set("ticketCount", v)}
        />
        <div>
          <label htmlFor="maxprice" className="block text-sm text-muted">
            Max price per ticket ($)
          </label>
          <input
            id="maxprice"
            type="number"
            min={1}
            step="0.01"
            value={(value.maxTicketPriceCents / 100).toFixed(2)}
            onChange={(e) => {
              const dollars = Number(e.target.value);
              if (!Number.isNaN(dollars) && dollars > 0)
                set("maxTicketPriceCents", Math.round(dollars * 100));
            }}
            className="mt-1 w-32 rounded-xl border border-white/10 bg-surface px-4 py-2 text-sm outline-none focus:border-gold/50"
          />
        </div>
      </div>

      {/* Seat rules */}
      <div>
        <p className="mb-3 text-sm font-medium">Seat rules</p>
        <div className="grid grid-cols-1 gap-6 rounded-2xl border border-white/10 bg-surface p-5 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm text-muted">Zone</span>
            <select
              value={value.seatRules.zone}
              onChange={(e) => setSeat("zone", e.target.value)}
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-gold/50"
            >
              {ZONE_OPTIONS.map((z) => (
                <option key={z} value={z}>
                  {z.charAt(0).toUpperCase() + z.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm text-muted">Rows</span>
            <select
              value={value.seatRules.rows}
              onChange={(e) => setSeat("rows", e.target.value)}
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-gold/50"
            >
              {ROW_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <Stepper
            label="Avoid front rows"
            value={value.seatRules.avoidFrontRows}
            min={0}
            max={10}
            onChange={(v) => setSeat("avoidFrontRows", v)}
          />
          <div className="flex flex-col gap-4">
            <Toggle
              checked={value.seatRules.adjacencyRequired}
              onChange={(v) => setSeat("adjacencyRequired", v)}
              label="Seats must be adjacent"
            />
            <Toggle
              checked={value.seatRules.accessibility}
              onChange={(v) => setSeat("accessibility", v)}
              label="Accessible seating"
            />
            <Toggle
              checked={value.seatRules.premiumFormatBias}
              onChange={(v) => setSeat("premiumFormatBias", v)}
              label="Prefer premium formats"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
