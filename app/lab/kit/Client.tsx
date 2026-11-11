"use client";

import { useState } from "react";
import Keycap from "@/components/ui/Keycap";
import { Chip, ChipGroup } from "@/components/ui/Chip";
import Panel from "@/components/ui/Panel";
import { TextArea, TextField } from "@/components/ui/Field";
import Switch from "@/components/ui/Switch";
import Dialog from "@/components/ui/Dialog";
import Dropzone from "@/components/ui/Dropzone";
import Slider from "@/components/Slider";
import PixelIcon from "@/components/PixelIcon";
import { PIXEL_ICONS, type PixelIconName } from "@/lib/pixel-icons";
import { accentVars } from "@/lib/colors";
import type { ToolColor } from "@/lib/tools";

const COLORS: ToolColor[] = ["green", "blue", "yellow", "tomato", "orange", "purple", "teal", "pink"];

/** The v2 kit on one page — a bench for checking shapes, focus and both pointer types. */
export default function Client() {
  const [color, setColor] = useState<ToolColor>("green");
  const [len, setLen] = useState(25);
  const [sound, setSound] = useState<"silent" | "noise">("silent");
  const [vol, setVol] = useState(40);
  const [strict, setStrict] = useState(true);
  const [heading, setHeading] = useState(false);
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<string>("nothing yet");
  return (
    <div style={accentVars(color)} className="page-col flex flex-col gap-10 px-5 py-10 sm:px-8">
      <section className="flex flex-col gap-3">
        <h2 className="label-pixel">Accent</h2>
        <ChipGroup label="Accent" value={color} onChange={setColor} options={COLORS.map((c) => ({ value: c, label: c }))} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="label-pixel">Keycaps</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Keycap tone="accent" size="lg">Start focus</Keycap>
          <Keycap tone="accent">Generate</Keycap>
          <Keycap>Copy all</Keycap>
          <Keycap tone="quiet">Quiet</Keycap>
          <Keycap tone="danger">Stop</Keycap>
          <Keycap size="sm">Small</Keycap>
          <Keycap size="icon" aria-label="Close"><PixelIcon name="close" size={12} /></Keycap>
          <Keycap tone="accent" disabled>Disabled</Keycap>
          <Keycap href="/lab">A link</Keycap>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="label-pixel">For how long?</h2>
        <ChipGroup
          label="For how long?"
          value={len}
          onChange={setLen}
          options={[{ value: 15, label: "15 min" }, { value: 25, label: "25 min" }, { value: 45, label: "45 min" }, { value: 60, label: "60 min", disabled: true }]}
        />
        <h2 className="label-pixel">Ambient sound</h2>
        <ChipGroup
          label="Ambient sound"
          value={sound}
          onChange={setSound}
          options={[{ value: "silent", label: "Silent" }, { value: "noise", label: "Brown noise" }]}
          trailing={<Chip>▸ hear it</Chip>}
        />
        <div className="flex flex-wrap gap-2">
          <Chip pressed={heading} onClick={() => setHeading((v) => !v)}>{heading ? "✓ Heading" : "+ Heading"}</Chip>
          <Chip>Copy</Chip>
          <Chip disabled>Unavailable</Chip>
        </div>
      </section>

      <section className="grid gap-5 sm:grid-cols-2">
        <TextField label="What are you focusing on?" placeholder="Write the email, sketch the page…" />
        <TextField label="With a hint" placeholder="Option" hint="Press Enter to add another." />
        <TextArea label="Paste a list" rows={3} placeholder={"One per line"} className="sm:col-span-2" />
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <Slider label="Volume" value={vol} min={0} max={100} onChange={setVol} unit="%" hint="The track fills with the accent." />
        <Slider label="Pixel size" value={len} min={5} max={60} step={5} onChange={setLen} />
        <Switch checked={strict} onChange={setStrict} label="Strict mode" hint="Three mistakes ends the game." />
        <p className="text-sm text-ink-soft">
          Open search with <kbd className="kbd-chunk">⌘K</kbd> or <kbd className="kbd-chunk">esc</kbd> to close.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Panel className="p-5"><p className="label-pixel">well</p><p className="mt-2 text-sm text-ink-soft">The inset surface. Things sit in it.</p></Panel>
        <Panel tone="raised" className="p-5"><p className="label-pixel">raised</p><p className="mt-2 text-sm text-ink-soft">One step lighter. Dialogs and floating panels.</p></Panel>
        <Panel tone="soft" className="p-5"><p className="label-pixel">soft</p><p className="mt-2 text-sm text-ink-soft">The accent&rsquo;s dark tint. Results and selected states.</p></Panel>
        <Panel tone="danger" className="p-5"><p className="label-pixel">danger</p><p className="mt-2 text-sm text-ink-soft">Errors and warnings.</p></Panel>
        <Panel as="button" type="button" tone="page" className="p-5 text-left"><p className="font-display text-2xl">A card you can press</p><p className="mt-1 text-sm text-ink-soft">Lifts on hover, ring on focus.</p></Panel>
        <Panel as="button" type="button" tone="soft" aria-pressed="true" className="p-5 text-left"><p className="font-display text-2xl">A selected card</p><p className="mt-1 text-sm text-ink-soft">Accent ring, soft fill.</p></Panel>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="label-pixel">Icons</h2>
        <div className="flex flex-wrap gap-3">
          {(Object.keys(PIXEL_ICONS) as PixelIconName[]).map((n) => (
            <div key={n} className="flex flex-col items-center gap-1.5">
              <span className="notch-sm flex h-12 w-12 items-center justify-center bg-(--accent) text-cream"><PixelIcon name={n} size={36} /></span>
              <span className="flex h-9 w-9 items-center justify-center text-ink"><PixelIcon name={n} size={24} /></span>
              <span className="flex h-5 w-5 items-center justify-center text-ink-soft"><PixelIcon name={n} size={12} /></span>
              <span className="label-pixel">{n}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Dropzone title="Drop a photo" hint="or click to choose" accept="image/*" onFiles={(f) => setFiles(f.map((x) => x.name).join(", "))}>
          <span className="label-pixel">got: {files}</span>
        </Dropzone>
        <div className="flex items-center">
          <Keycap onClick={() => setOpen(true)}>Open a dialog</Keycap>
        </div>
      </section>

      <Dialog open={open} onClose={() => setOpen(false)} label="Example dialog" className="w-full max-w-md p-6">
        <h2 className="font-display text-3xl leading-none">A dialog</h2>
        <p className="mt-3 text-sm text-ink-soft">Flat dark scrim, raised stepped panel. Tab stays inside; Escape closes.</p>
        <div className="mt-5 flex gap-3">
          <Keycap tone="accent" onClick={() => setOpen(false)}>Done</Keycap>
          <Keycap onClick={() => setOpen(false)}>Cancel</Keycap>
        </div>
      </Dialog>
    </div>
  );
}
