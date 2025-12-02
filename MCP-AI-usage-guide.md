# MCP AI Usage Guide (Compact Version)

## 1. Available MCP Interface
### Resources
- **`wsjt-x://decodes`** — returns a `DecodesSnapshot`.

### Events
- **`resources/updated`** (for `wsjt-x://decodes`)
  - Sent at the end of each decode cycle.
  - Includes the **full DecodesSnapshot**.

### Tools
- **`call_cq({ band?, freq_hz?, mode? })`**
- **`answer_decoded_station({ decode_id, force_mode? })`**
- **`rig_get_state()`** *(optional)*

No slice IDs, channel numbers, or WSJT-X instance details are exposed.

---

## 2. Canonical Types

### DecodeRecord
```
id                     string
timestamp              string (ISO)
band                   string
mode                   "FT8" | "FT4"
dial_hz                number
audio_offset_hz        number
rf_hz                  number
snr_db                 number
dt_sec                 number
call                   string
grid                   string | null
is_cq                  boolean
is_my_call             boolean
is_directed_cq_to_me   boolean
cq_target_token        string | null
raw_text               string

is_new?                boolean
low_confidence?        boolean
off_air?               boolean
```

### DecodesSnapshot
```
snapshot_id: string
generated_at: string
decodes: DecodeRecord[]
```

---

## 3. How the AI Client Should Operate

### Event-driven flow
1. Wait for `resources/updated` events.
2. Read `params.snapshot`.
3. Use `snapshot.decodes` directly.

---

## 4. Selecting a Station to Answer

### Filter candidates
```ts
const candidates = snapshot.decodes.filter(d =>
  d.is_cq &&
  d.is_directed_cq_to_me &&
  !already_worked(d.call, d.band, d.mode)
);
```

### Rank and choose
```ts
const best = candidates.sort((a, b) => b.snr_db - a.snr_db)[0];
```

### Answer
```ts
answer_decoded_station({ decode_id: best.id });
```

---

## 5. When No Suitable Target Exists

Start CQ:
```ts
call_cq({ band: "20m", mode: "FT8" });
```

---

## 6. Rules the AI Must Follow

### MUST:
- Only respond if:
  - `is_cq === true`
  - `is_directed_cq_to_me === true`
- Use **decode_id** only.
- Treat snapshot from the event as authoritative.

### MUST NOT:
- Parse CQ text manually.
- Use or infer slice/channel/instance information.
- Attempt low-level WSJT-X control.

---

## 7. Recovery Logic
If needed:
```ts
const snapshot = getResource("wsjt-x://decodes");
```

---

## 8. Full Summary Algorithm

```ts
on resources/updated:
  snapshot = params.snapshot
  decodes = snapshot.decodes

  targets = decodes
    .filter(d =>
      d.is_cq &&
      d.is_directed_cq_to_me &&
      !already_worked(d.call, d.band, d.mode)
    )
    .sort((a, b) => b.snr_db - a.snr_db)

  if (targets.length > 0):
    answer_decoded_station({ decode_id: targets[0].id })
  else:
    call_cq({ band: "20m", mode: "FT8" })
```

---

This guide is designed for embedding directly into AI instructions or prompt templates.
