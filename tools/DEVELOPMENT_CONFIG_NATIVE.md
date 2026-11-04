# Native development configuration

`org.sou1.audio.DevelopmentConfig` is an immutable, Android-independent setup-time DTO. `DevelopmentScore(int rate, long seed, DevelopmentConfig config)` retains it across reset/reseed. The existing two-argument constructor uses `DevelopmentConfig.DEFAULT` and retains the frozen v1 event stream.

## Fields and wire schema

| Field | JSON scalar | Native value |
| --- | --- | --- |
| tonic | `"seed"` or integer 0–11 | `SEED` (-1) or 0–11 |
| mode | `"seed"` or integer 0–6 | -1 or 0–6 |
| meter | `"seed"` or integer 0–5 | -1 or 0–5 |
| rhythmFamily | `"seed"` or integer 0–7 | -1 or 0–7 |
| arpStrategy | `"seed"` or integer 0–7 | -1 or 0–7 |
| drumPattern | `"seed"` or integer 0–7 | -1 or 0–7 |
| harmony | `"auto"`, `"fixed"`, `"progression"`, `"modulating"` | same String |
| drumVariation | `"auto"` or finite number 0–1 | `AUTO_VARIATION` (-1) or 0–1 |

Constructor:

```java
new DevelopmentConfig(int tonic, int mode, int meter, int rhythmFamily,
    int arpStrategy, int drumPattern, String harmony, double drumVariation)
```

The constructor validates native sentinel/range/enum values. `fromMap(Map<String, ?>)` additionally enforces the closed JSON-like schema and rejects coercions: explicit null, numeric strings, booleans, unknown keys and numeric -1 sentinels are invalid wire values. Omitted fields use defaults. `isKnownKey`, `parseSelector`, `parseHarmony`, and `parseDrumVariation` are available for a bridge that inspects JSON itself. No JSONObject or Android APIs are required.

`toJson()` returns all eight normalized fields. Numeric spelling need not be byte-identical to JS `JSON.stringify`; compare parsed fields. The DTO never retains a mutable map.

## Bounded native Intent/preferences key

`canonicalKey()` returns a versioned native-only key. `parseKey(String)` accepts only its canonical spelling. The default is:

```
d1|-1|-1|-1|-1|-1|-1|auto|-1
```

There must be exactly nine pipe-separated tokens: version plus the eight fields in the table order. Input is bounded at 256 characters. Unknown versions, empty/extra tokens, invalid ranges/enums, non-finite values, whitespace, alternate numeric spellings and negative-zero variation strings are rejected. Numeric drum variation uses Java `Double.toString`; the automatic sentinel is `-1`. Valid keys round-trip exact field values. This is not a cross-JS identity format.

Parse and construct the DTO on a control/setup thread. Keep the object in the session and pass it into the score constructor; no key parsing, JSON serialization or object creation belongs on the audio render path. Configuration changes construct a new stopped session. Musical reseed preserves the current config.

## Semantics

- Manual tonic selects the anchor pitch class (root 48 plus tonic). Manual mode never changes during modulation.
- Manual rhythm and arpeggio selectors remain fixed while phrase motifs continue developing.
- Percussion family is independent of manual melodic rhythm. Eight concrete drum patterns are supported.
- Drum variation zero removes phrase-level drum dynamics, fills and cymbal accents, producing repeatable bars at steady controls. Automatic variation preserves the old behavior.
- Fixed harmony holds chord zero. Auto/progression retain the developing chord grammar. Modulating additionally alternates a related tonic (anchor +5 or +7 pitch classes) and the anchor on bounded phrase boundaries.
- Phase-one transport remains pause/resume: melodic tails freeze after Stop, while recorded drum tails are cleared. Reset/reseed clear paused voices. Separate configuration sessions must not reuse the previous session's voices.

## Focused validation

`sh tests/run-development-config.sh` runs the original 948 cases against both configured default JS and a SHA-pinned frozen v1 comparator, then strict config/key/behavior tests and configured numerical event parity. The fixture producer calls the real JS random-config helper; Java receives concrete configurations and does not implement another randomizer.

For an external JS workspace, set `DEVELOPMENT_SCORE_JS` to its absolute `docs/development-score.js` path. Production sources also compile with Java 8 source/target and use APIs available on Android minSdk 26. Tests run on a host JVM/Node; they do not establish Android-device, real-bank asset loading, or listening validation.
