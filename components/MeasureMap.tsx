"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import area from "@turf/area";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

import {
  estimateServiceableArea,
  saveMeasurementWithGeometry,
} from "@/app/properties/actions";
import {
  colorForKind,
  computeEffectiveTurf,
  computeNetAreas,
  labelForKind,
  normalizeKind,
  roundSqft,
  sqftFromM2,
} from "@/lib/geo/area";
import {
  AREA_KINDS,
  type AreaKind,
  type MapView,
  type ParcelResult,
  type ServiceAreaCollection,
  type ServiceAreaFeature,
} from "@/lib/geo/types";
import type { Confidence } from "@/lib/pricing/types";

const SATELLITE_STYLE = "mapbox://styles/mapbox/satellite-streets-v12";
const READONLY_SRC = "saved-areas";
const PARCEL_SRC = "parcel-boundary";

// Color a draw feature by its kind (MapboxDraw exposes user props as `user_*`),
// incl. legacy aliases, so polygons are distinguishable WHILE editing — not only
// after save. Falls back to the "other" color for unknown/unset kinds.
const KIND_COLOR_MATCH: unknown[] = [
  "match",
  ["get", "user_kind"],
  ...AREA_KINDS.flatMap((k) => [k, colorForKind(k)] as [string, string]),
  "parking",
  colorForKind("pavement"),
  "sidewalk",
  colorForKind("pavement"),
  "exclude",
  colorForKind("other"),
  colorForKind("other"),
];

// Custom MapboxDraw theme: inactive polygons filled/outlined by kind; the
// selected (active) polygon keeps a bright dashed outline so you can tell what
// you're editing, plus vertex/midpoint handles.
const DRAW_STYLES: object[] = [
  {
    id: "gl-draw-polygon-fill-inactive",
    type: "fill",
    filter: ["all", ["==", "active", "false"], ["==", "$type", "Polygon"], ["!=", "mode", "static"]],
    paint: { "fill-color": KIND_COLOR_MATCH, "fill-opacity": 0.3 },
  },
  {
    id: "gl-draw-polygon-stroke-inactive",
    type: "line",
    filter: ["all", ["==", "active", "false"], ["==", "$type", "Polygon"], ["!=", "mode", "static"]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": KIND_COLOR_MATCH, "line-width": 2 },
  },
  {
    id: "gl-draw-polygon-fill-active",
    type: "fill",
    filter: ["all", ["==", "active", "true"], ["==", "$type", "Polygon"]],
    paint: { "fill-color": KIND_COLOR_MATCH, "fill-opacity": 0.45 },
  },
  {
    id: "gl-draw-polygon-stroke-active",
    type: "line",
    filter: ["all", ["==", "active", "true"], ["==", "$type", "Polygon"]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#fbb03b", "line-dasharray": [0.2, 2], "line-width": 3 },
  },
  {
    id: "gl-draw-polygon-midpoint",
    type: "circle",
    filter: ["all", ["==", "$type", "Point"], ["==", "meta", "midpoint"]],
    paint: { "circle-radius": 3, "circle-color": "#fbb03b" },
  },
  {
    id: "gl-draw-polygon-and-line-vertex-halo-active",
    type: "circle",
    filter: ["all", ["==", "meta", "vertex"], ["==", "$type", "Point"], ["!=", "mode", "static"]],
    paint: { "circle-radius": 5, "circle-color": "#ffffff" },
  },
  {
    id: "gl-draw-polygon-and-line-vertex-active",
    type: "circle",
    filter: ["all", ["==", "meta", "vertex"], ["==", "$type", "Point"], ["!=", "mode", "static"]],
    paint: { "circle-radius": 3, "circle-color": "#fbb03b" },
  },
];

type Props = {
  token: string | null;
  propertyId: string;
  center: [number, number]; // [lng, lat]
  zoom: number;
  geocoded: boolean;
  initialAreas: ServiceAreaCollection | null;
  parcel: ParcelResult | null;
  initialCountTreeGrass: boolean;
  initial: {
    turf_sqft: number;
    bed_sqft: number;
    complexity: number;
    confidence: Confidence;
  };
};

/** Average of a polygon's exterior ring — good enough for a label anchor. */
function ringCentroid(coords: number[][][]): [number, number] {
  const ring = coords[0] ?? [];
  if (!ring.length) return [0, 0];
  let x = 0;
  let y = 0;
  for (const [lng, lat] of ring) {
    x += lng;
    y += lat;
  }
  return [x / ring.length, y / ring.length];
}

/** Delete all draw features whose (normalized) kind is in `kinds`. */
function deleteFeaturesByKind(draw: MapboxDraw, kinds: Set<string>) {
  const all = draw.getAll() as GeoJSON.FeatureCollection;
  const ids = all.features
    .filter((f) => kinds.has(normalizeKind(f.properties?.kind)))
    .map((f) => String(f.id))
    .filter((id) => id && id !== "undefined");
  if (ids.length) {
    try {
      draw.delete(ids);
    } catch {
      /* ids may already be gone */
    }
  }
}

/** Recompute each drawn feature's kind + area_sqft into a ServiceAreaCollection. */
function toCollection(fc: GeoJSON.FeatureCollection): ServiceAreaCollection {
  const features: ServiceAreaFeature[] = fc.features
    .filter((f) => f.geometry?.type === "Polygon")
    .map((f) => {
      const kind = normalizeKind(f.properties?.kind);
      const sqft = roundSqft(sqftFromM2(area(f as GeoJSON.Feature)));
      return {
        type: "Feature",
        id: f.id,
        properties: { kind, area_sqft: sqft },
        geometry: f.geometry as ServiceAreaFeature["geometry"],
      };
    });
  return { type: "FeatureCollection", features };
}

export function MeasureMap({
  token,
  propertyId,
  center,
  zoom,
  geocoded,
  initialAreas,
  parcel,
  initialCountTreeGrass,
  initial,
}: Props) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  const hasSaved = !!initialAreas?.features?.length;
  const [editing, setEditing] = useState(!hasSaved);
  const [drawKind, setDrawKind] = useState<AreaKind>("turf");
  const [areas, setAreas] = useState<ServiceAreaCollection | null>(initialAreas);

  // Controlled measurement fields (map fills these; manual override allowed).
  const [turfSqft, setTurfSqft] = useState(initial.turf_sqft);
  const [bedSqft, setBedSqft] = useState(initial.bed_sqft);
  const [complexity, setComplexity] = useState(initial.complexity);
  const [confidence, setConfidence] = useState<Confidence>(initial.confidence);

  const [pending, startTransition] = useTransition();
  const [estimating, setEstimating] = useState(false);
  const [vegPct, setVegPct] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [countTreeGrass, setCountTreeGrass] = useState(initialCountTreeGrass);
  const countTreeGrassRef = useRef(initialCountTreeGrass);

  // Net areas resolve overlaps by precedence (e.g. grass medians inside a dropped
  // parking lot stay turf, not double-counted) — used for the totals strip.
  const netAreas = computeNetAreas(areas, countTreeGrass);

  // --- Recompute totals from the current draw features ---
  const refreshFromDraw = useCallback(() => {
    const draw = drawRef.current;
    if (!draw) return;
    const fc = toCollection(draw.getAll() as GeoJSON.FeatureCollection);
    setAreas(fc);
    // Priced areas use net (overlap-resolved) geometry: turf minus overlapping
    // building/bed (and tree canopy unless grass-under-trees is on); pavement
    // does not subtract from turf.
    const net = computeNetAreas(fc, countTreeGrassRef.current);
    setTurfSqft(roundSqft(net.turf));
    setBedSqft(roundSqft(net.bed));
    setSaved(false);
  }, []);

  // --- Parcel boundary reference layer (dashed outline; not editable) ---
  const addParcelLayer = useCallback((map: mapboxgl.Map, p: ParcelResult) => {
    if (map.getSource(PARCEL_SRC)) return;
    const feature: GeoJSON.Feature = {
      type: "Feature",
      properties: {},
      geometry: p.geometry as GeoJSON.Geometry,
    };
    map.addSource(PARCEL_SRC, { type: "geojson", data: feature });
    map.addLayer({
      id: `${PARCEL_SRC}-line`,
      type: "line",
      source: PARCEL_SRC,
      paint: { "line-color": "#f5d142", "line-width": 2.5, "line-dasharray": [2, 1.5] },
    });
  }, []);

  // --- Read-only overlay of saved polygons (fill + outline + sqft labels) ---
  const addReadonlyLayers = useCallback((map: mapboxgl.Map, fc: ServiceAreaCollection) => {
    const labelFc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: fc.features.map((f) => ({
        type: "Feature",
        properties: { label: `${f.properties.area_sqft.toLocaleString()} sf` },
        geometry: { type: "Point", coordinates: ringCentroid(f.geometry.coordinates) },
      })),
    };
    map.addSource(READONLY_SRC, { type: "geojson", data: fc as unknown as GeoJSON.FeatureCollection });
    map.addSource(`${READONLY_SRC}-labels`, { type: "geojson", data: labelFc });
    map.addLayer({
      id: `${READONLY_SRC}-fill`,
      type: "fill",
      source: READONLY_SRC,
      paint: {
        "fill-color": [
          "match",
          ["get", "kind"],
          ...AREA_KINDS.flatMap((k) => [k, colorForKind(k)] as [string, string]),
          colorForKind("other"),
        ],
        "fill-opacity": 0.35,
      },
    });
    map.addLayer({
      id: `${READONLY_SRC}-line`,
      type: "line",
      source: READONLY_SRC,
      paint: { "line-color": "#ffffff", "line-width": 2 },
    });
    map.addLayer({
      id: `${READONLY_SRC}-label`,
      type: "symbol",
      source: `${READONLY_SRC}-labels`,
      layout: { "text-field": ["get", "label"], "text-size": 12 },
      paint: { "text-color": "#ffffff", "text-halo-color": "#000000", "text-halo-width": 1.2 },
    });
  }, []);

  const removeReadonlyLayers = useCallback((map: mapboxgl.Map) => {
    for (const id of [`${READONLY_SRC}-fill`, `${READONLY_SRC}-line`, `${READONLY_SRC}-label`]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource(READONLY_SRC)) map.removeSource(READONLY_SRC);
    if (map.getSource(`${READONLY_SRC}-labels`)) map.removeSource(`${READONLY_SRC}-labels`);
  }, []);

  // --- Init map once ---
  useEffect(() => {
    if (!token || !mapContainer.current || mapRef.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: SATELLITE_STYLE,
      center,
      zoom,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    // Single source of truth for "map finished loading". Covers the case where
    // the load event already fired before a listener is attached.
    const markReady = () => setMapReady(true);
    if (map.loaded()) markReady();
    else map.on("load", markReady);
    map.on("error", (e) => {
      // Surface a hint but don't crash; tiles/style errors are usually token/network.
      if (e?.error?.message) setMapError(e.error.message);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      drawRef.current = null;
      markerRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // --- Once loaded: pin (if not geocoded) + parcel reference overlay ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (!geocoded && !markerRef.current) {
      markerRef.current = new mapboxgl.Marker({ draggable: true, color: "#2f6f4e" })
        .setLngLat(center)
        .addTo(map);
    }
    if (parcel) addParcelLayer(map, parcel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, geocoded, parcel]);

  // --- Toggle between read-only and edit (draw) modes (runs once loaded) ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (editing) {
      removeReadonlyLayers(map);
      if (!drawRef.current) {
        try {
          const draw = new MapboxDraw({
            displayControlsDefault: false,
            controls: { trash: true },
            styles: DRAW_STYLES,
            userProperties: true, // expose `kind` as `user_kind` to the styles
          });
          drawRef.current = draw;
          map.addControl(draw);
          const on = map.on.bind(map) as (t: string, cb: (...a: unknown[]) => void) => void;
          on("draw.create", onDrawCreate as (...a: unknown[]) => void);
          on("draw.update", refreshFromDraw);
          on("draw.delete", refreshFromDraw);
          if (areas) {
            draw.set(areas as unknown as GeoJSON.FeatureCollection);
            // Recompute mowable turf from the loaded polygons so re-opening an
            // older measurement reflects the current subtraction logic.
            refreshFromDraw();
          }
        } catch (err) {
          setMapError(
            "Drawing tools failed to initialize: " +
              (err instanceof Error ? err.message : String(err))
          );
        }
      }
    } else if (drawRef.current) {
      const off = map.off.bind(map) as (t: string, cb: (...a: unknown[]) => void) => void;
      off("draw.create", onDrawCreate as (...a: unknown[]) => void);
      off("draw.update", refreshFromDraw);
      off("draw.delete", refreshFromDraw);
      map.removeControl(drawRef.current);
      drawRef.current = null;
      if (areas) addReadonlyLayers(map, areas);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, editing]);

  // Assign the currently-selected kind to a freshly drawn polygon, then recompute.
  const onDrawCreate = useCallback(
    (e: { features: GeoJSON.Feature[] }) => {
      const draw = drawRef.current;
      if (!draw) return;
      for (const f of e.features) {
        if (f.id != null) draw.setFeatureProperty(String(f.id), "kind", drawKindRef.current);
      }
      refreshFromDraw();
    },
    [refreshFromDraw]
  );

  // Keep the latest drawKind available to the stable onDrawCreate callback.
  const drawKindRef = useRef<AreaKind>(drawKind);
  useEffect(() => {
    drawKindRef.current = drawKind;
  }, [drawKind]);

  const startDrawing = (kind: AreaKind) => {
    setDrawKind(kind);
    drawKindRef.current = kind;
    drawRef.current?.changeMode("draw_polygon");
  };

  // Seed the draw with the parcel outline as a turf polygon to trim down.
  const useParcelAsTurf = () => {
    const draw = drawRef.current;
    if (!parcel) return;
    if (!draw) {
      setMapError("Drawing tools aren't ready yet — give the map a moment and retry.");
      return;
    }
    // Replace any existing turf so re-clicking (incl. after re-opening) resets
    // turf to the parcel outline instead of stacking duplicates.
    deleteFeaturesByKind(draw, new Set(["turf"]));
    const polys: number[][][][] =
      parcel.geometry.type === "MultiPolygon"
        ? (parcel.geometry.coordinates as number[][][][])
        : [parcel.geometry.coordinates as number[][][]];
    for (const coords of polys) {
      const ids = draw.add({
        type: "Feature",
        properties: { kind: "turf" },
        geometry: { type: "Polygon", coordinates: coords },
      } as GeoJSON.Feature);
      for (const id of ids) draw.setFeatureProperty(String(id), "kind", "turf");
    }
    refreshFromDraw();
  };

  // RGB vegetation detection: estimate serviceable area + overlay the mask.
  const estimateVeg = () => {
    setEstimating(true);
    startTransition(async () => {
      try {
        const est = await estimateServiceableArea(propertyId);
        const map = mapRef.current;
        if (!est || !map) {
          setMapError("Couldn't estimate from imagery (needs a parcel + map token).");
          return;
        }
        if (map.getLayer("veg-mask-layer")) map.removeLayer("veg-mask-layer");
        if (map.getSource("veg-mask")) map.removeSource("veg-mask");
        map.addSource("veg-mask", {
          type: "image",
          url: est.mask_data_url,
          coordinates: est.coordinates,
        });
        map.addLayer({
          id: "veg-mask-layer",
          type: "raster",
          source: "veg-mask",
          paint: { "raster-opacity": 0.65 },
        });
        setVegPct(est.vegetation_fraction);
        setTurfSqft(est.turf_sqft);
        setSaved(false);
      } finally {
        setEstimating(false);
      }
    });
  };

  // Toggle whether grass under tree canopy counts as mowable turf.
  const onToggleTreeGrass = (v: boolean) => {
    setCountTreeGrass(v);
    countTreeGrassRef.current = v;
    setTurfSqft(roundSqft(computeEffectiveTurf(areas, v)));
    setSaved(false);
  };

  const onSave = () => {
    const map = mapRef.current;
    if (!map || !areas) return;
    const c = map.getCenter();
    const view: MapView = {
      center: [c.lng, c.lat],
      zoom: map.getZoom(),
      count_tree_grass: countTreeGrass,
    };
    const pin = markerRef.current?.getLngLat();
    const lngLat = pin ? [pin.lng, pin.lat] : [c.lng, c.lat];

    startTransition(async () => {
      await saveMeasurementWithGeometry(propertyId, {
        turf_sqft: turfSqft,
        bed_sqft: bedSqft,
        complexity,
        confidence,
        service_areas: areas,
        map_view: view,
        lng: lngLat[0],
        lat: lngLat[1],
      });
      setSaved(true);
      setEditing(false);
    });
  };

  if (!token) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
        Map unavailable: set a public Mapbox token (<code>MAPBOX_API</code>, a{" "}
        <code>pk.</code> token) in the environment to enable the aerial measure view.
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Aerial measure &amp; audit</h2>
        {hasSaved && !editing ? (
          <button
            onClick={() => setEditing(true)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Edit areas
          </button>
        ) : null}
      </div>

      {mapError ? (
        <p className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
          Map issue: {mapError}
        </p>
      ) : null}

      {!geocoded ? (
        <p className="mt-1 text-sm text-amber-700">
          Address couldn&apos;t be located — drag the green pin onto the property, then draw.
        </p>
      ) : null}

      {parcel ? (
        <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-500">
          <span className="inline-block h-2.5 w-3 border-b-2 border-dashed border-yellow-400" />
          Parcel ({parcel.county} County)
          {parcel.owner ? ` · ${parcel.owner}` : ""}
          {parcel.acres ? ` · ${parcel.acres.toFixed(2)} ac` : ""}
        </p>
      ) : null}

      {editing ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-500">Draw:</span>
          {AREA_KINDS.map((k) => (
            <button
              key={k}
              onClick={() => startDrawing(k)}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm hover:bg-gray-50 ${
                drawKind === k ? "border-gray-800 ring-1 ring-gray-300" : "border-gray-300"
              }`}
            >
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ backgroundColor: colorForKind(k) }}
              />
              {labelForKind(k)}
            </button>
          ))}
          {parcel ? (
            <button
              onClick={useParcelAsTurf}
              className="rounded-md border border-yellow-400 bg-yellow-50 px-2.5 py-1 text-sm text-yellow-800 hover:bg-yellow-100"
            >
              Use parcel outline as turf
            </button>
          ) : null}
          {parcel ? (
            <button
              onClick={estimateVeg}
              disabled={estimating}
              className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-sm text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
            >
              {estimating ? "Analyzing…" : "Estimate turf from imagery (beta)"}
            </button>
          ) : null}
          <span className="ml-2 text-xs text-gray-400">
            Click to drop points; double-click to close the shape. Use the trash icon to delete.
          </span>
        </div>
      ) : null}

      <div
        ref={mapContainer}
        className="mt-3 h-[80vh] min-h-[560px] w-full overflow-hidden rounded-md bg-gray-100"
      />

      {/* Totals strip — service areas (priced) then other categories. Turf shows
          the mowable (priced) value: drawn turf minus overlapping hard surfaces. */}
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        {AREA_KINDS.map((k) => (
          <Total
            key={k}
            label={k === "turf" ? "Turf (mowable)" : labelForKind(k)}
            value={`${Math.round(k === "turf" ? turfSqft : netAreas[k]).toLocaleString()} sf`}
            kind={k}
            priced={k === "turf" || k === "bed"}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-gray-400">
        Overlaps resolve by precedence, so areas never double-count: precise
        features (<span className="font-medium text-gray-500">Turf</span>,{" "}
        <span className="font-medium text-gray-500">Building</span>,{" "}
        <span className="font-medium text-gray-500">Bed</span>,{" "}
        <span className="font-medium text-gray-500">Tree</span>) win over a coarsely-dropped{" "}
        <span className="font-medium text-gray-500">Pavement</span> — e.g. grass medians inside a
        parking lot stay Turf. Priced Turf = net turf minus any Building/Bed inside it (and tree
        canopy, unless the toggle below is on).
      </p>
      {vegPct !== null ? (
        <p className="mt-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-800">
          Imagery estimate: ~{(vegPct * 100).toFixed(0)}% of the parcel is vegetation (green
          overlay) → filled into Turf. Note: this includes tree canopy and is sensitive to
          season/shadows — refine by drawing beds/trees and trimming, then save.
        </p>
      ) : null}

      {editing ? (
        <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
          {netAreas.tree > 0 ? (
            <label className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={countTreeGrass}
                onChange={(e) => onToggleTreeGrass(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
              />
              <span className="text-gray-700">
                Count grass under tree canopy as mowable turf
                <span className="text-gray-400">
                  {" "}
                  (+{Math.round(netAreas.tree).toLocaleString()} sf)
                </span>
              </span>
            </label>
          ) : null}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <NumField label="Turf sqft (priced)" value={turfSqft} onChange={setTurfSqft} />
            <NumField label="Bed sqft" value={bedSqft} onChange={setBedSqft} />
            <NumField label="Complexity" step={0.1} value={complexity} onChange={setComplexity} />
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Confidence</span>
              <select
                value={confidence}
                onChange={(e) => setConfidence(e.target.value as Confidence)}
                className="input mt-1"
              >
                <option value="High">High</option>
                <option value="Med">Med</option>
                <option value="Low">Low</option>
              </select>
            </label>
          </div>
          <p className="text-xs text-gray-400">
            Drawing fills the sqft fields; you can override them before saving.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={onSave}
              disabled={pending || !areas?.features?.length}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save areas & recompute price"}
            </button>
            {hasSaved ? (
              <button
                onClick={() => setEditing(false)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            ) : null}
            {saved ? <span className="text-sm text-green-600">Saved.</span> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Total({
  label,
  value,
  kind,
  priced,
}: {
  label: string;
  value: string;
  kind: AreaKind;
  priced?: boolean;
}) {
  return (
    <div className={`rounded-md border p-2.5 ${priced ? "border-gray-300 bg-gray-50" : "border-gray-200"}`}>
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: colorForKind(kind) }} />
        {label}
      </div>
      <div className="mt-0.5 font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <input
        type="number"
        min={0}
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="input mt-1"
      />
    </label>
  );
}
