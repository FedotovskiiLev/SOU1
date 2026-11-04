// SPDX-License-Identifier: AGPL-3.0-only
package org.sou1.audio;

import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Synchronous, dependency-free preparation of the nine bundled recorded kits.
 * Call on a background preparation worker, NEVER the render/service callback or
 * UI thread. It performs I/O, SHA-256, decoding, resampling and allocations.
 * An Android adapter can use AssetManager::open; paths are relative to the
 * existing generated web assets root ("audio-kit/..."). No network is used.
 *
 * JSON is validated at build time by generate-native-drum-catalog.mjs. At run
 * time the exact package lock and manifest bytes must match the generated
 * catalog before any WAV is accepted. There is no arbitrary manifest/path API.
 * Every source WAV is checked, including unused articulations, as in the JS
 * loader. Original WAVs and source PCM are never changed or normalized.
 *
 * This is a preparation building block, not service/device qualification. The
 * caller owns cancellation, worker lifetime and atomic publication of bank.
 * Interrupting the worker aborts preparation without clearing interrupt status.
 * There is no fallback to a different kit after a failed load.
 */
public final class NativeDrumBankLoader {
    private NativeDrumBankLoader() { }
    private static final int MIB = 1024 * 1024;
    private static final String[] IDS = {"kick", "snare", "closed-hat", "toms", "short-clash"};

    /** Must return a fresh finite stream. The loader always closes it. */
    @FunctionalInterface
    public interface AssetReader {
        InputStream open(String relativePath) throws IOException;
    }

    /** Optional stricter budgets. Values may reduce, never raise, hard caps. */
    public static final class Budgets {
        public final int encodedBytes, decodedBytes, mappedBytes, preparedBytes;
        public Budgets(int encodedBytes, int decodedBytes, int mappedBytes, int preparedBytes) {
            if (encodedBytes < 0 || encodedBytes > 12 * MIB || decodedBytes < 0 ||
                    decodedBytes > 16 * MIB || mappedBytes < 0 || mappedBytes > 16 * MIB ||
                    preparedBytes < 0 || preparedBytes > 16 * MIB) {
                throw new IllegalArgumentException("Native drum budgets");
            }
            this.encodedBytes = encodedBytes;
            this.decodedBytes = decodedBytes;
            this.mappedBytes = mappedBytes;
            this.preparedBytes = preparedBytes;
        }
    }
    public static final Budgets DEFAULT_BUDGETS = new Budgets(12 * MIB, 16 * MIB, 16 * MIB, 16 * MIB);

    public static final class Source {
        public final String id, manifest, sha256, sourceCommit;
        private Source(SourceSpec source) {
            id = source.id; manifest = source.path; sha256 = source.sha256; sourceCommit = source.sourceCommit;
        }
    }

    public static final class Conversion {
        public final int sampleIndex, frames, sourceRate, targetRate;
        /** Null for unpitched one-shots; a MIDI note for materialized pitches. */
        public final Integer pitch;
        public final double step, peak;
        /** Canonical little-endian IEEE Float32 bytes, independent of host order. */
        public final String pcmSha256;
        private Conversion(int index, float[] pcm, int sourceRate, int targetRate,
                           Integer pitch, double step) {
            sampleIndex = index; frames = pcm.length; this.sourceRate = sourceRate;
            this.targetRate = targetRate; this.pitch = pitch; this.step = step;
            double maximum = 0;
            for (float value : pcm) maximum = Math.max(maximum, Math.abs(value));
            peak = maximum; pcmSha256 = pcmHash(pcm);
        }
    }

    /** Immutable preparation evidence. Lists/maps and their members cannot mutate. */
    public static final class Report {
        public final String kit;
        public final int sampleRate, encodedBytes, sourceDecodedBytes, sourceMappedBytes, preparedBytes;
        public final double preparedPeak;
        public final List<Source> banks;
        public final Map<String, String> instrumentBanks;
        public final List<Conversion> converted;
        /** Null for the unchanged original whole-kit path. */
        public final CustomSelection selection;
        public final Map<String, RoleSource> roleSources;
        public final List<List<SampleOrigin>> sampleOrigins;
        public final Memory memory;
        private Report(String kit, int rate, Plan plan, List<Source> sources,
                       Map<String, String> provenance, List<Conversion> conversions) {
            this(kit, rate, plan, sources, provenance, conversions, null, Collections.emptyMap(), Collections.emptyList(), null);
        }
        private Report(String kit, int rate, Plan plan, List<Source> sources,
                       Map<String, String> provenance, List<Conversion> conversions,
                       CustomSelection selection, Map<String, RoleSource> roles,
                       List<List<SampleOrigin>> origins, Memory memory) {
            this.selection = selection; this.memory = memory;
            roleSources = Collections.unmodifiableMap(new LinkedHashMap<>(roles));
            sampleOrigins = copyList(origins);
            this.kit = kit; sampleRate = rate; encodedBytes = plan.encoded;
            sourceDecodedBytes = plan.decoded; sourceMappedBytes = plan.mapped;
            preparedBytes = plan.prepared;
            banks = copyList(sources); converted = copyList(conversions);
            instrumentBanks = Collections.unmodifiableMap(new LinkedHashMap<>(provenance));
            double maximum = 0;
            for (Conversion conversion : conversions) maximum = Math.max(maximum, conversion.peak);
            preparedPeak = maximum;
        }
    }

    public static final class Prepared {
        public final LiveDrumPool.Bank bank;
        public final Report report;
        private Prepared(LiveDrumPool.Bank bank, Report report) { this.bank = bank; this.report = report; }
    }

    /** Closed immutable registry; "procedural" deliberately is not a recorded kit. */
    public static List<String> supportedKits() { return NativeDrumCatalog.KITS; }

    public static Prepared prepare(String kit, int targetRate, AssetReader reader) throws IOException {
        return prepare(kit, targetRate, reader, DEFAULT_BUDGETS);
    }

    public static Prepared prepare(String kit, int targetRate, AssetReader reader, Budgets budgets) throws IOException {
        if (reader == null || budgets == null) throw new IllegalArgumentException("Native drum reader/budgets");
        List<SourceSpec> sources = NativeDrumCatalog.sources(kit);
        Plan plan = preflight(sources, targetRate, budgets); // All declared budgets before ANY asset I/O.
        checkInterrupted();
        readVerified(reader, "audio-kit/SOURCE_LOCK.json", NativeDrumCatalog.LOCK_BYTES,
                NativeDrumCatalog.LOCK_SHA256, 128 * 1024);
        // Verify every manifest before accepting source audio. No JSON parser is needed at runtime.
        for (SourceSpec source : sources) {
            readVerified(reader, "audio-kit/" + source.path, source.bytes, source.sha256, 128 * 1024);
        }
        Map<String, LoadedInstrument> selected = new HashMap<>();
        Map<String, String> provenance = new LinkedHashMap<>();
        List<Source> sourceReports = new ArrayList<>();
        for (SourceSpec source : sources) {
            List<float[]> decoded = new ArrayList<>();
            String directory = source.path.substring(0, source.path.lastIndexOf('/') + 1);
            for (SampleSpec sample : source.samples) {
                byte[] bytes = readVerified(reader, "audio-kit/" + directory + sample.file,
                        sample.bytes, sample.sha256, 4 * MIB);
                decoded.add(decodeWav(bytes, sample, 8 * MIB));
            }
            for (InstrumentSpec instrument : source.instruments) {
                if (isLiveId(instrument.id)) {
                    selected.put(instrument.id, new LoadedInstrument(source, instrument, decoded));
                    provenance.put(instrument.id, source.id);
                }
            }
            sourceReports.add(new Source(source));
        }
        List<float[]> samples = new ArrayList<>();
        List<Conversion> conversions = new ArrayList<>();
        List<LiveDrumPool.Instrument> definitions = new ArrayList<>();
        for (String id : IDS) {
            LoadedInstrument loaded = selected.get(id);
            InstrumentSpec instrument = loaded.instrument;
            List<LiveDrumPool.Zone> zones = new ArrayList<>();
            // JS SampleInstrument clones sample identities per instrument. Do not
            // coalesce equal WAVs across instruments or distinct declared samples.
            Map<Long, Integer> cache = new HashMap<>();
            for (ZoneSpec zone : instrument.zones) {
                SampleSpec sample = loaded.source.samples.get(zone.sample);
                int first = zone.pitched ? zone.low : -1, last = zone.pitched ? zone.high : -1;
                for (int pitch = first; pitch <= last; pitch++) {
                    long key = ((long) zone.sample << 8) | (pitch + 1);
                    Integer index = cache.get(key);
                    if (index == null) {
                        double step = step(sample, targetRate, pitch);
                        float[] pcm = reconstruct(loaded.samples.get(zone.sample), step);
                        index = samples.size(); samples.add(pcm); cache.put(key, index);
                        conversions.add(new Conversion(index, pcm, sample.rate, targetRate,
                                pitch < 0 ? null : pitch, step));
                    }
                    zones.add(new LiveDrumPool.Zone(index, pitch < 0 ? zone.low : pitch,
                            pitch < 0 ? zone.high : pitch, zone.velocityLow, zone.velocityHigh));
                }
            }
            definitions.add(new LiveDrumPool.Instrument(id, instrument.gain, true,
                    instrument.choke, zones.toArray(new LiveDrumPool.Zone[0])));
        }
        checkInterrupted();
        LiveDrumPool.Bank bank = new LiveDrumPool.Bank(targetRate, samples.toArray(new float[0][]),
                definitions.toArray(new LiveDrumPool.Instrument[0]));
        checkInterrupted();
        return new Prepared(bank, new Report(kit, targetRate, plan, sourceReports, provenance, conversions));
    }

    public static final List<String> CUSTOM_ROLES = copyList(java.util.Arrays.asList("kick", "snare", "hihat", "toms", "cymbal"));

    /** Canonical immutable selector. No procedural/recorded mixtures or paths. */
    public static final class CustomSelection {
        public final String baseKit, key;
        public final Map<String, String> overrides, resolvedKits;
        private CustomSelection(String base, Map<String, String> overrides, Map<String, String> resolved, String key) {
            baseKit = base; this.key = key;
            this.overrides = Collections.unmodifiableMap(new LinkedHashMap<>(overrides));
            resolvedKits = Collections.unmodifiableMap(new LinkedHashMap<>(resolved));
        }
    }
    public static CustomSelection normalizeCustomSelection(String baseKit, Map<String, String> overrides) {
        if (!supportedKits().contains(baseKit) || overrides == null) throw new IllegalArgumentException("Custom drum selection");
        for (Map.Entry<?, ?> entry : overrides.entrySet()) {
            if (!(entry.getKey() instanceof String) || !CUSTOM_ROLES.contains(entry.getKey()) ||
                    !(entry.getValue() instanceof String)) throw new IllegalArgumentException("Custom drum role/value");
        }
        Map<String, String> normalized = new LinkedHashMap<>(), resolved = new LinkedHashMap<>();
        StringBuilder key = new StringBuilder("custom-v1|").append(baseKit); boolean changed = false;
        for (String role : CUSTOM_ROLES) {
            String value = overrides.containsKey(role) ? overrides.get(role) : "inherit";
            if (!"inherit".equals(value) && !supportedKits().contains(value)) throw new IllegalArgumentException("Unknown recorded drum kit");
            if (baseKit.equals(value)) value = "inherit";
            normalized.put(role, value); resolved.put(role, "inherit".equals(value) ? baseKit : value);
            changed |= !"inherit".equals(value); key.append('|').append(value);
        }
        return new CustomSelection(baseKit, normalized, resolved, changed ? key.toString() : baseKit);
    }
    public static String customSelectionKey(String baseKit, Map<String, String> overrides) {
        return normalizeCustomSelection(baseKit, overrides).key;
    }
    public static CustomSelection parseCustomSelection(String key) {
        if (key == null || key.length() > 160) throw new IllegalArgumentException("Custom drum selection key");
        if (supportedKits().contains(key)) return normalizeCustomSelection(key, Collections.emptyMap());
        String[] tokens = key.split("\\|", -1);
        if (tokens.length != 7 || !"custom-v1".equals(tokens[0])) throw new IllegalArgumentException("Custom drum selection key");
        Map<String, String> overrides = new LinkedHashMap<>();
        for (int i = 0; i < CUSTOM_ROLES.size(); i++) overrides.put(CUSTOM_ROLES.get(i), tokens[i + 2]);
        CustomSelection result = normalizeCustomSelection(tokens[1], overrides);
        if (!result.key.equals(key)) throw new IllegalArgumentException("Noncanonical custom drum selection key");
        return result;
    }
    public static final class RoleSource {
        public final String kit, id, manifest, sha256, sourceCommit;
        private RoleSource(String kit, SourceSpec source) {
            this.kit = kit; id = source.id; manifest = source.path; sha256 = source.sha256; sourceCommit = source.sourceCommit;
        }
    }
    public static final class SampleOrigin {
        public final String role, kit, bankId, manifest, manifestSha256, sourceCommit, sampleId, file, sha256;
        public final int sourceRate, rootNote;
        private SampleOrigin(String role, String kit, SourceSpec source, SampleSpec sample) {
            this.role = role; this.kit = kit; bankId = source.id; manifest = source.path;
            manifestSha256 = source.sha256; sourceCommit = source.sourceCommit;
            sampleId = sample.id; file = sample.file; sha256 = sample.sha256;
            sourceRate = sample.rate; rootNote = sample.root;
        }
    }
    /** Live sample-buffer bounds, not total VM heap or GC timing guarantees. */
    public static final class Memory {
        public final int peakSourceDecodedBytes, peakSourceMappedBytes;
        public final int transientPcmBytesUpperBound, transientEncodedBytesUpperBound, publicationCopyBytes;
        private Memory(int decoded, int mapped, int prepared, int maxWav) {
            peakSourceDecodedBytes = decoded; peakSourceMappedBytes = mapped;
            // Native decoding does not make SampleInstrument's JS mapped copies.
            // Bank construction privately copies prepared PCM once.
            transientPcmBytesUpperBound = Math.max(prepared + decoded, 2 * prepared);
            transientEncodedBytesUpperBound = Math.max(128 * 1024, maxWav);
            publicationCopyBytes = prepared;
        }
    }
    public static Prepared prepareSelection(String key, int rate, AssetReader reader) throws IOException {
        return prepareSelection(key, rate, reader, DEFAULT_BUDGETS);
    }
    public static Prepared prepareSelection(String key, int rate, AssetReader reader, Budgets budgets) throws IOException {
        CustomSelection selection = parseCustomSelection(key);
        return prepareCustom(selection.baseKit, selection.overrides, rate, reader, budgets);
    }
    public static Prepared prepareCustom(String baseKit, Map<String, String> overrides, int rate, AssetReader reader) throws IOException {
        return prepareCustom(baseKit, overrides, rate, reader, DEFAULT_BUDGETS);
    }
    /** For custom assembly, decoded/mapped budgets apply to one source at a time. */
    public static Prepared prepareCustom(String baseKit, Map<String, String> overrides, int rate, AssetReader reader, Budgets budgets) throws IOException {
        CustomSelection selection = normalizeCustomSelection(baseKit, overrides);
        if (selection.key.equals(baseKit)) return prepare(baseKit, rate, reader, budgets);
        if (reader == null || budgets == null || rate < 8000 || rate > 192000) throw new IllegalArgumentException("Custom drum reader/budgets/rate");
        CustomPlan plan = customPreflight(selection, rate, budgets);
        checkInterrupted();
        readVerified(reader, "audio-kit/SOURCE_LOCK.json", NativeDrumCatalog.LOCK_BYTES, NativeDrumCatalog.LOCK_SHA256, 128 * 1024);
        for (SourceSpec source : plan.sources) readVerified(reader, "audio-kit/" + source.path, source.bytes, source.sha256, 128 * 1024);
        float[][] samples = new float[plan.samples.size()][];
        Conversion[] converted = new Conversion[samples.length];
        for (SourceSpec source : plan.sources) {
            // All WAVs in each selected source remain checksum-verified, including
            // its unused articulations. Only selected prepared PCM survives.
            prepareCustomSource(source, plan.samples, rate, reader, samples, converted);
        }
        checkInterrupted();
        LiveDrumPool.Bank bank = new LiveDrumPool.Bank(rate, samples, plan.instruments.toArray(new LiveDrumPool.Instrument[0]));
        checkInterrupted();
        List<List<SampleOrigin>> origins = new ArrayList<>();
        for (CustomSample sample : plan.samples) origins.add(copyList(sample.origins));
        return new Prepared(bank, new Report(selection.key, rate, plan.budget, plan.sourceReports,
                plan.provenance, java.util.Arrays.asList(converted), selection, plan.roleSources, origins, plan.memory));
    }
    private static void prepareCustomSource(SourceSpec source, List<CustomSample> selected, int rate,
                                           AssetReader reader, float[][] output, Conversion[] converted) throws IOException {
        List<float[]> decoded = new ArrayList<>();
        String directory = source.path.substring(0, source.path.lastIndexOf('/') + 1);
        for (SampleSpec sample : source.samples) {
            byte[] bytes = readVerified(reader, "audio-kit/" + directory + sample.file, sample.bytes, sample.sha256, 4 * MIB);
            decoded.add(decodeWav(bytes, sample, 8 * MIB));
        }
        for (int i = 0; i < selected.size(); i++) {
            CustomSample sample = selected.get(i);
            if (sample.source != source) continue;
            float[] pcm = reconstruct(decoded.get(sample.sourceIndex), sample.step);
            output[i] = pcm;
            converted[i] = new Conversion(i, pcm, sample.sample.rate, rate, sample.pitch < 0 ? null : sample.pitch, sample.step);
        }
    }
    private static final class CustomSample {
        final SourceSpec source; final SampleSpec sample; final int sourceIndex, pitch; final double step;
        final List<SampleOrigin> origins = new ArrayList<>();
        CustomSample(SourceSpec source, int index, int pitch, double step) {
            this.source = source; sourceIndex = index; sample = source.samples.get(index); this.pitch = pitch; this.step = step;
        }
    }
    private static final class CustomPlan {
        final List<SourceSpec> sources = new ArrayList<>();
        final List<Source> sourceReports = new ArrayList<>();
        final List<CustomSample> samples = new ArrayList<>();
        final List<LiveDrumPool.Instrument> instruments = new ArrayList<>();
        final Map<String, String> provenance = new LinkedHashMap<>();
        final Map<String, RoleSource> roleSources = new LinkedHashMap<>();
        Plan budget; Memory memory;
    }
    private static CustomPlan customPreflight(CustomSelection selection, int rate, Budgets budgets) throws IOException {
        CustomPlan plan = new CustomPlan();
        Map<String, SourceSpec> uniqueSources = new LinkedHashMap<>();
        Map<String, Integer> identities = new HashMap<>();
        long preparedBytes = 0;
        for (int roleIndex = 0; roleIndex < IDS.length; roleIndex++) {
            String role = CUSTOM_ROLES.get(roleIndex), id = IDS[roleIndex], kit = selection.resolvedKits.get(role);
            List<SourceSpec> candidates = NativeDrumCatalog.sources(kit);
            // Validate the closed catalog at a safe rate independently of the
            // unused whole kit's prepared size at the requested rate.
            preflight(candidates, 8000, DEFAULT_BUDGETS);
            SourceSpec source = null; InstrumentSpec instrument = null;
            for (SourceSpec candidate : candidates) for (InstrumentSpec item : candidate.instruments) {
                if (item.id.equals(id)) { source = candidate; instrument = item; }
            }
            if (source == null || instrument == null || !instrument.oneShot) throw new IOException("Incomplete one-shot custom drum bank");
            uniqueSources.put(source.path, source);
            plan.provenance.put(id, source.id); plan.roleSources.put(role, new RoleSource(kit, source));
            List<LiveDrumPool.Zone> zones = new ArrayList<>();
            for (ZoneSpec zone : instrument.zones) {
                if (zone.pitched && zone.high - zone.low + 1 > 16) throw new IOException("Pitched drum key range");
                int first = zone.pitched ? zone.low : -1, last = zone.pitched ? zone.high : -1;
                SampleSpec sample = source.samples.get(zone.sample);
                for (int pitch = first; pitch <= last; pitch++) {
                    double step = step(sample, rate, pitch);
                    if (!Double.isFinite(step) || step < .125 || step > 8) throw new IOException("Prepared sample ratio");
                    String identity = sample.sha256 + '|' + sample.rate + '|' + sample.root + '|' + pitch;
                    Integer index = identities.get(identity);
                    if (index == null) {
                        long frames = (long) StrictMath.ceil(sample.frames / step);
                        preparedBytes += frames * Float.BYTES;
                        if (frames < 2 || frames > (long) rate * 10 || plan.samples.size() >= LiveDrumPool.MAX_SAMPLES ||
                                preparedBytes > budgets.preparedBytes) throw new IOException("Prepared custom drum bank memory");
                        index = plan.samples.size(); identities.put(identity, index);
                        plan.samples.add(new CustomSample(source, zone.sample, pitch, step));
                    }
                    CustomSample prepared = plan.samples.get(index); boolean known = false;
                    for (SampleOrigin origin : prepared.origins) if (origin.role.equals(role) && origin.manifest.equals(source.path) && origin.sampleId.equals(sample.id)) known = true;
                    if (!known) prepared.origins.add(new SampleOrigin(role, kit, source, sample));
                    if (zones.size() >= LiveDrumPool.MAX_ZONES) throw new IOException("Custom drum zone count");
                    zones.add(new LiveDrumPool.Zone(index, pitch < 0 ? zone.low : pitch, pitch < 0 ? zone.high : pitch, zone.velocityLow, zone.velocityHigh));
                }
            }
            plan.instruments.add(new LiveDrumPool.Instrument(id, instrument.gain, true, instrument.choke, zones.toArray(new LiveDrumPool.Zone[0])));
        }
        long encoded = 0, decoded = 0, mapped = 0; int peakDecoded = 0, peakMapped = 0, maxWav = 0;
        for (SourceSpec source : uniqueSources.values()) {
            int localDecoded = 0, localMapped = 0;
            for (SampleSpec sample : source.samples) { encoded += sample.bytes; localDecoded += sample.frames * Float.BYTES; maxWav = Math.max(maxWav, sample.bytes); }
            for (InstrumentSpec instrument : source.instruments) {
                Set<Integer> seen = new HashSet<>();
                for (ZoneSpec zone : instrument.zones) if (seen.add(zone.sample)) localMapped += source.samples.get(zone.sample).frames * Float.BYTES;
            }
            if (encoded > budgets.encodedBytes || localDecoded > Math.min(8 * MIB, budgets.decodedBytes) ||
                    localMapped > Math.min(8 * MIB, budgets.mappedBytes)) throw new IOException("Custom drum source memory budget");
            decoded += localDecoded; mapped += localMapped;
            peakDecoded = Math.max(peakDecoded, localDecoded); peakMapped = Math.max(peakMapped, localMapped);
            plan.sources.add(source); plan.sourceReports.add(new Source(source));
        }
        plan.budget = new Plan(encoded, decoded, mapped, preparedBytes);
        plan.memory = new Memory(peakDecoded, peakMapped, (int) preparedBytes, maxWav);
        return plan;
    }

    // Package-private immutable catalog descriptions, not an arbitrary public manifest API.
    static final class SampleSpec {
        final String id, file, sha256;
        final int bytes, frames, rate, root;
        SampleSpec(String id, String file, String sha256, int bytes, int frames, int rate, int root) {
            this.id = id; this.file = file; this.sha256 = sha256; this.bytes = bytes;
            this.frames = frames; this.rate = rate; this.root = root;
        }
    }
    static final class ZoneSpec {
        final int sample, low, high;
        final double velocityLow, velocityHigh;
        final boolean pitched;
        ZoneSpec(int sample, int low, int high, double velocityLow, double velocityHigh, boolean pitched) {
            this.sample = sample; this.low = low; this.high = high;
            this.velocityLow = velocityLow; this.velocityHigh = velocityHigh; this.pitched = pitched;
        }
    }
    static final class InstrumentSpec {
        final String id, choke;
        final double gain;
        final boolean oneShot;
        final List<ZoneSpec> zones;
        InstrumentSpec(String id, double gain, boolean oneShot, String choke, List<ZoneSpec> zones) {
            this.id = id; this.gain = gain; this.oneShot = oneShot; this.choke = choke;
            this.zones = copyList(zones);
        }
    }
    static final class SourceSpec {
        final String path, sha256, id, sourceCommit;
        final int bytes;
        final List<SampleSpec> samples;
        final List<InstrumentSpec> instruments;
        SourceSpec(String path, int bytes, String sha256, String id, String sourceCommit,
                   List<SampleSpec> samples, List<InstrumentSpec> instruments) {
            this.path = path; this.bytes = bytes; this.sha256 = sha256; this.id = id;
            this.sourceCommit = sourceCommit; this.samples = copyList(samples);
            this.instruments = copyList(instruments);
        }
    }
    private static final class LoadedInstrument {
        final SourceSpec source;
        final InstrumentSpec instrument;
        final List<float[]> samples;
        LoadedInstrument(SourceSpec source, InstrumentSpec instrument, List<float[]> samples) {
            this.source = source; this.instrument = instrument; this.samples = samples;
        }
    }
    private static <T> List<T> copyList(List<T> list) {
        return Collections.unmodifiableList(new ArrayList<>(list));
    }
    static final class Plan {
        final int encoded, decoded, mapped, prepared;
        Plan(long encoded, long decoded, long mapped, long prepared) {
            this.encoded = (int) encoded; this.decoded = (int) decoded;
            this.mapped = (int) mapped; this.prepared = (int) prepared;
        }
    }

    static Plan preflight(List<SourceSpec> sources, int rate, Budgets budgets) throws IOException {
        if (rate < 8000 || rate > 192000) throw new IllegalArgumentException("Native drum sample rate");
        if (sources.isEmpty() || sources.size() > 2) throw new IOException("Native drum source count");
        long encoded = 0, decoded = 0, mapped = 0;
        Map<String, SourceSpec> selectedSources = new HashMap<>();
        Map<String, InstrumentSpec> selected = new HashMap<>();
        for (SourceSpec source : sources) {
            if (!safePath(source.path) || !source.path.matches("assets/(?:[a-z0-9-]+/)+manifest(?:-[a-z0-9-]+)?\\.json") ||
                    source.bytes < 2 || source.bytes > 128 * 1024 || !hash(source.sha256, 64) ||
                    !id(source.id) || !hash(source.sourceCommit, 40) || source.samples.isEmpty() ||
                    source.samples.size() > 64 || source.instruments.isEmpty() || source.instruments.size() > 32) {
                throw new IOException("Native drum source metadata/path");
            }
            long bankDecoded = 0, bankMapped = 0;
            Set<String> sampleIds = new HashSet<>(), instrumentIds = new HashSet<>();
            for (SampleSpec sample : source.samples) {
                if (!id(sample.id) || !sampleIds.add(sample.id) || sample.file == null ||
                        !sample.file.matches("[a-z0-9-]+\\.wav") || !hash(sample.sha256, 64) ||
                        sample.bytes < 44 || sample.bytes > 4 * MIB || sample.frames < 2 ||
                        sample.frames > 192000 * 30 || sample.rate < 8000 || sample.rate > 192000 ||
                        sample.root < 0 || sample.root > 127) throw new IOException("Native drum sample metadata/path");
                encoded += sample.bytes; bankDecoded += (long) sample.frames * Float.BYTES;
            }
            decoded += bankDecoded;
            for (InstrumentSpec instrument : source.instruments) {
                if (!id(instrument.id) || !instrumentIds.add(instrument.id) || !unit(instrument.gain) ||
                        (instrument.choke != null && (instrument.choke.isEmpty() || instrument.choke.length() > 32)) ||
                        instrument.zones.isEmpty() || instrument.zones.size() > 64) throw new IOException("Native drum instrument metadata");
                Set<Integer> mappedSamples = new HashSet<>();
                for (ZoneSpec zone : instrument.zones) {
                    if (zone.sample < 0 || zone.sample >= source.samples.size() || zone.low < 0 ||
                            zone.high > 127 || zone.low > zone.high || !unit(zone.velocityLow) ||
                            !unit(zone.velocityHigh) || zone.velocityLow > zone.velocityHigh) throw new IOException("Native drum zone metadata");
                    if (mappedSamples.add(zone.sample)) bankMapped += (long) source.samples.get(zone.sample).frames * Float.BYTES;
                }
                if (isLiveId(instrument.id)) {
                    if (!instrument.oneShot) throw new IOException("Live drum source must be one-shot");
                    selected.put(instrument.id, instrument); selectedSources.put(instrument.id, source);
                }
            }
            mapped += bankMapped;
            if (bankDecoded > 8 * MIB || bankMapped > 8 * MIB || encoded > budgets.encodedBytes ||
                    decoded > budgets.decodedBytes || mapped > budgets.mappedBytes) throw new IOException("Native drum source memory budget");
        }
        long prepared = 0; int count = 0;
        for (String id : IDS) {
            InstrumentSpec instrument = selected.get(id);
            if (instrument == null) throw new IOException("Incomplete recorded drum bank");
            Set<Long> cache = new HashSet<>(); int zones = 0;
            for (ZoneSpec zone : instrument.zones) {
                if (zone.pitched && zone.high - zone.low + 1 > 16) throw new IOException("Pitched drum key range");
                int first = zone.pitched ? zone.low : -1, last = zone.pitched ? zone.high : -1;
                for (int pitch = first; pitch <= last; pitch++) {
                    if (++zones > LiveDrumPool.MAX_ZONES) throw new IOException("Native drum zone count");
                    if (!cache.add(((long) zone.sample << 8) | (pitch + 1))) continue;
                    SampleSpec sample = selectedSources.get(id).samples.get(zone.sample);
                    double step = step(sample, rate, pitch);
                    if (!Double.isFinite(step) || step < .125 || step > 8) throw new IOException("Prepared sample ratio");
                    long frames = (long) StrictMath.ceil(sample.frames / step);
                    prepared += frames * Float.BYTES;
                    if (frames < 2 || frames > (long) rate * 10 || ++count > LiveDrumPool.MAX_SAMPLES ||
                            prepared > budgets.preparedBytes) throw new IOException("Prepared drum bank memory");
                }
            }
        }
        return new Plan(encoded, decoded, mapped, prepared);
    }

    private static boolean isLiveId(String id) {
        for (String candidate : IDS) if (candidate.equals(id)) return true;
        return false;
    }
    private static boolean id(String id) { return id != null && id.matches("[a-z0-9-]{1,64}"); }
    private static boolean hash(String hash, int length) { return hash != null && hash.matches("[a-f0-9]{" + length + "}"); }
    private static boolean unit(double n) { return Double.isFinite(n) && n >= 0 && n <= 1; }
    static boolean safePath(String path) {
        if (path == null || path.length() > 256 || !path.matches("[a-zA-Z0-9_./-]+") || path.startsWith("/")) return false;
        for (String part : path.split("/", -1)) if (part.isEmpty() || part.equals(".") || part.equals("..")) return false;
        return true;
    }
    private static double step(SampleSpec sample, int rate, int pitch) {
        return (double) sample.rate / rate * (pitch < 0 ? 1 : StrictMath.pow(2, (pitch - sample.root) / 12.0));
    }
    private static void checkInterrupted() throws InterruptedIOException {
        if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException("Native drum preparation interrupted");
    }

    static byte[] readVerified(AssetReader reader, String path, int expected, String sha256, int limit) throws IOException {
        if (!safePath(path) || expected < 1 || expected > limit || limit > 4 * MIB || !hash(sha256, 64)) {
            throw new IOException("Native drum asset bounds/path");
        }
        checkInterrupted();
        byte[] bytes = new byte[expected];
        try (InputStream stream = reader.open(path)) {
            if (stream == null) throw new IOException("Missing native drum asset: " + path);
            int offset = 0;
            while (offset < expected) {
                checkInterrupted();
                int n = stream.read(bytes, offset, Math.min(8192, expected - offset));
                if (n < 0) throw new IOException("Truncated native drum asset: " + path);
                if (n == 0) { // A non-conforming stream must not cause an infinite loop.
                    int value = stream.read();
                    if (value < 0) throw new IOException("Truncated native drum asset: " + path);
                    bytes[offset++] = (byte) value;
                } else offset += n;
            }
            if (stream.read() != -1) throw new IOException("Oversized native drum asset: " + path);
        }
        checkInterrupted();
        if (!hex(digest().digest(bytes)).equals(sha256)) throw new IOException("Native drum checksum mismatch: " + path);
        return bytes;
    }

    /** Strict mono RIFF PCM16/24 decoder, before any Float32 allocation. */
    static float[] decodeWav(byte[] bytes, SampleSpec sample, int maxDecodedBytes) throws IOException {
        if (bytes == null || bytes.length < 44 || bytes.length > 4 * MIB || maxDecodedBytes < 8 ||
                maxDecodedBytes > 8 * MIB) throw new IOException("WAV input/decoded bounds");
        if (!tag(bytes, 0, "RIFF") || !tag(bytes, 8, "WAVE") || u32(bytes, 4) + 8 != bytes.length) throw new IOException("Invalid RIFF size/signature");
        int format = -1, channels = -1, rate = -1, align = -1, bits = -1, dataAt = -1, dataSize = -1;
        long byteRate = -1;
        for (long at = 12; at < bytes.length;) {
            if (at + 8 > bytes.length) throw new IOException("Truncated WAV chunk");
            int index = (int) at; long size = u32(bytes, index + 4), end = at + 8 + size;
            if (end > bytes.length) throw new IOException("Truncated WAV chunk payload");
            if (tag(bytes, index, "fmt ")) {
                if (format != -1 || size < 16) throw new IOException("Invalid WAV fmt chunk");
                format = u16(bytes, index + 8); channels = u16(bytes, index + 10);
                long declaredRate = u32(bytes, index + 12);
                if (declaredRate < 8000 || declaredRate > 192000) throw new IOException("Unsupported WAV rate");
                rate = (int) declaredRate; byteRate = u32(bytes, index + 16);
                align = u16(bytes, index + 20); bits = u16(bytes, index + 22);
            }
            if (tag(bytes, index, "data")) {
                if (dataAt != -1) throw new IOException("Duplicate WAV data chunk");
                dataAt = index + 8; dataSize = (int) size;
            }
            at = end + (size & 1);
            if (at > bytes.length) throw new IOException("Missing WAV chunk padding");
        }
        if (format != 1 || channels != 1 || (bits != 16 && bits != 24) || dataAt < 0) throw new IOException("Unsupported mono PCM WAV");
        int width = bits / 8, frames = dataSize / width;
        if (align != width || byteRate != (long) rate * width || dataSize % width != 0 || frames < 2 ||
                (long) frames * Float.BYTES > maxDecodedBytes) throw new IOException("WAV shape/decoded budget");
        if (sample != null && (bytes.length != sample.bytes || rate != sample.rate || frames != sample.frames)) throw new IOException("WAV sample metadata mismatch");
        float[] pcm = new float[frames];
        for (int i = 0; i < frames; i++) {
            if ((i & 4095) == 0) checkInterrupted();
            int p = dataAt + i * width;
            if (width == 2) pcm[i] = (short) u16(bytes, p) / 32768.0f;
            else {
                int n = (bytes[p] & 255) | ((bytes[p + 1] & 255) << 8) | ((bytes[p + 2] & 255) << 16);
                pcm[i] = ((n ^ 8388608) - 8388608) / 8388608.0f;
            }
        }
        return pcm;
    }
    private static boolean tag(byte[] bytes, int at, String value) {
        for (int i = 0; i < 4; i++) if (bytes[at + i] != value.charAt(i)) return false;
        return true;
    }
    private static int u16(byte[] bytes, int at) { return (bytes[at] & 255) | ((bytes[at + 1] & 255) << 8); }
    private static long u32(byte[] bytes, int at) { return (u16(bytes, at) | ((long) u16(bytes, at + 2) << 16)); }

    /** The JS 16-tap Hann-windowed sinc, including its edge/weight behavior. */
    static float[] reconstruct(float[] pcm, double step) throws IOException {
        if (!Double.isFinite(step) || step < .125 || step > 8 || pcm == null || pcm.length < 2) throw new IOException("Prepared sample ratio/input");
        long frames = (long) StrictMath.ceil(pcm.length / step);
        if (frames < 2 || frames * Float.BYTES > 16 * MIB) throw new IOException("Prepared PCM size");
        float[] out = new float[(int) frames]; double cut = Math.min(1, 1 / step) * .92;
        for (int n = 0; n < out.length; n++) {
            if ((n & 4095) == 0) checkInterrupted();
            double pos = n * step; int base = (int) StrictMath.floor(pos);
            double sum = 0, weights = 0;
            for (int j = base - 7; j <= base + 8; j++) {
                double distance = pos - j;
                if (Math.abs(distance) >= 8) continue;
                double x = distance * cut;
                double sinc = Math.abs(x) < 1e-9 ? 1 : StrictMath.sin(Math.PI * x) / (Math.PI * x);
                double weight = cut * sinc * (.5 + .5 * StrictMath.cos(Math.PI * distance / 8));
                weights += weight;
                if (j >= 0 && j < pcm.length) sum += pcm[j] * weight;
            }
            out[n] = (float) (Math.abs(weights) > 1e-9 ? sum / weights : 0);
            if (!Float.isFinite(out[n]) || Math.abs(out[n]) > 2) throw new IOException("Prepared PCM reconstruction range");
        }
        return out;
    }
    private static MessageDigest digest() {
        try { return MessageDigest.getInstance("SHA-256"); }
        catch (NoSuchAlgorithmException impossible) { throw new AssertionError("SHA-256 required by Java", impossible); }
    }
    private static String hex(byte[] bytes) {
        char[] digits = "0123456789abcdef".toCharArray(), out = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i++) { out[i * 2] = digits[(bytes[i] & 255) >>> 4]; out[i * 2 + 1] = digits[bytes[i] & 15]; }
        return new String(out);
    }
    private static String pcmHash(float[] pcm) {
        MessageDigest digest = digest(); byte[] chunk = new byte[4096]; int at = 0;
        for (float value : pcm) {
            int bits = Float.floatToRawIntBits(value);
            for (int shift = 0; shift < 32; shift += 8) chunk[at++] = (byte) (bits >>> shift);
            if (at == chunk.length) { digest.update(chunk); at = 0; }
        }
        digest.update(chunk, 0, at); return hex(digest.digest());
    }
}
