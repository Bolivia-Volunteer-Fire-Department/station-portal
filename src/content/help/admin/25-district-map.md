*Content → Map Setup* is where the district map is configured, and its three cards represent different layers of information:

IMAGE HERE

| Card | What it holds |
|---|---|
| **District boundary** | The station's district as REAL coordinates — a polygon in latitude and longitude. This is the map members see |
| **Map background** | The county's own linework, copied once and clipped to the boundary: its roads, its waterways, the FEMA flood zones, the fire districts around this one, and the major roads out through those neighbours — with the road names and the beat on each side of a road |
| **District Map** | The department's own drawn map, as an SVG. An optional second view, for a drawing that carries detail the boundary does not |

They used to be cards in the middle of *System Settings*, between the department name and the clock rounding. They are the ground the station covers rather than station configuration, so they have a screen of their own — and *System Settings* keeps a line pointing at it for anybody who goes looking where the boundary used to be.

> [!IMPORTANT]
> **Two permissions open this page.** **Maintain the district map** is the officer who draws on the map — it opens this screen on its own, with no administrator rights, and holds the boundary and the background; **Manage system settings** holds the uploaded drawing. Members need **View the district map** to see the map at all — see *Who sees it* below.

## GIS Data Source

The **GIS Data Source** dropdown configures where the application fetches beat boundaries and regional GIS layers from:

- **Brunswick County, NC (Default)**: Preconfigured for Brunswick County's official ArcGIS Open Data endpoints for beats, roads, waterways, flood zones, and neighboring districts.
- **Custom / Manual GeoJSON**: Allows departments in other jurisdictions or counties to supply their own boundaries or upload GeoJSON files.

IMAGE HERE

## Setting the boundary (do this first)

The boundary is the map. Everything else — landmarks, distances, the view the module opens on — follows from it.

IMAGE HERE

**Most stations should fetch it from the county.** Brunswick County publishes every fire department's beat as open data, with the department's own name on it, and this card looks it up by name:

1. The search box is filled in from your **Department Name** setting, reduced to the word that identifies the place — *Bolivia Volunteer Fire Department* searches for **BOLIVIA**.
2. Press **Look up**. Every matching beat is listed with the county's own name for it, the department and its phone number.
3. Press the one that is yours. It appears in an amber panel saying **not saved yet**.
4. Press **Save boundary**.

**Choosing is not saving**, and that matters: saving replaces the line every member sees on the map.

What is stored is a COPY of the county's line, not a link to it. After that the map reads nothing from the county at all, which is why it works with no signal and why the day the county retires their server is not the day this screen breaks. The county's own service is credited on the map. Refreshing it, after a redraw, is the same four steps — which for most stations is about once a year.

**If your county does not publish its beats**, export the boundary from your GIS system as **GeoJSON** and press **Upload GeoJSON**. The file must be a polygon or multipolygon in latitude/longitude (WGS 84, EPSG 4326) — a projected grid is refused, because nothing outside that grid can make sense of it. The app checks it and says what is wrong if something is.

A boundary is about 50 KB and roughly 2,000 points for a district this size. The limits are 40,000 points and the same 900 KB document ceiling everything else uses.

## The drawn map (optional)

The **District Map** card holds an SVG drawing — the department's own picture of the map, exported from whatever it was drawn in. Members find it behind the **Drawing** view in the module.

Be aware of what it is and is not: a drawing has no coordinates, so it cannot be looked up, measured, pinned or compared against a neighbour's district, and a traced drawing exported at full detail can be very large indeed (the app's limit is 900 KB, because that is what a database document holds). It is worth uploading when the drawing shows something the boundary does not — and worth leaving out when it is only a picture of the boundary.

**Choosing is not saving** here either: pick the file, check the preview, then press **Save Map**. An SVG carrying a script, or pointing at files outside itself, is refused with a sentence saying which it is.

## Map background

The **Map background** card holds the county's linework that is drawn under the boundary: the **roads**, the **waterways**, the **flood zones**, the **neighboring districts**, and the **nearby roads** that run out through them. One row per layer, each with **Fetch** (or **Refresh**) and **Remove**.

**It needs the boundary first**, because the fetch is CLIPPED to it: the county has these layers for the whole county, and only the ground around this district is wanted. Without a boundary the card says so rather than pulling down fifteen times the data.

Two things happen on the county's side while it fetches, and together they turn the layers into something a document can hold and a phone can draw:

- The geometry is **clipped** — to the district outline for the water and the flood zones, to the district **plus a kilometer band** around it for the roads and the neighboring districts (whose own subject does not stop at your line), and to the neighboring districts' **own outlines** for the nearby roads — see below for why those last are not simply a bigger band.
- It is **generalized** — simplified — before it is sent. This is the part that matters: the water alone is 29,584 points at survey detail and 9,806 at five meters, and none of the 20,000 points dropped is visible at the scale a district is drawn at. Roads are simplified to about a meter, because a road has corners somebody can see from a street; water to about five meters, because a shoreline is a curve nobody measures; and the flood zones to about twenty-two meters, which turns 1.4 MB of them into 80 KB.

The result is stored in the station's own records, like the boundary, which is why the background is on the map **with no signal** and why it keeps working if the county's server is ever retired. Refreshing it is the same button, a year later.

**The band is why the roads and the neighboring districts reach past your boundary.** A district line runs down the middle of roads and along other departments' doorsteps, so a map that stopped dead at the red line could not show the far side of a road you are standing on, nor whose ground is next door. It is asked for as a **box** around the district rather than a buffered outline — a box contains the band, so nothing inside it is ever missed, and it costs a few percent more bytes rather than a call to a second county service to shape a clip.

**The nearby roads are the neighboring districts' major roads, and they are fetched differently for two measured reasons.** They are not just a wider band, because a box drawn around all nine neighbors spans 41×46 km and returns **more roads than the county will send in one answer** (it caps every layer at 2,000 records and silently cuts the rest off). Instead the fetch first asks which beats touch a kilometer around this district, then clips the road layer to **each neighboring beat's own outline**, one at a time — an outline, not a box, because a multi-ring polygon is read by the county as rings *with holes*, not as a union, so the shapes have to be asked about separately and stitched back together here. And only the **major roads** (posted speed 35 mph and up) come back: every road in every neighbor is ~5,500 lines and well over a document, where the arterials are ~3,100 and fit. A member reading the map gets the way through and out — the highways and the named routes that matter at district scale — and zooms in to a neighborhood for the rest, exactly as they would on the county's own viewer.

**Four of the roads' fields are kept, and they are the ones worth their bytes**: `NAME` and `FULLNAME` (the two spellings of the name the county keeps, which is what gets drawn along the road) and `FIRELEFT` / `FIRERIGHT` (the department covering each side). Across a district that is about forty kilobytes — 115 KB against 77 without — and it is what turns a background into a map where the streets are named and "whose district is this side?" is answered by tapping a road. The other forty columns the county offers (speed limits, zip codes, addressing detail) are **not** stored or even asked for: requesting them tripled the payload for information nothing draws.

Which attributes are kept is per layer, in `MAP_BACKDROP_FIELDS` (`src/utils/districtMap.js`) — the roads keep those four, the water keeps none, the flood zones keep which zone they are, the neighboring districts keep the county's name for the beat, and the **nearby roads keep only their name** (`NAME` / `FULLNAME`): they are somebody else's streets, so who covers each side is not a question this station asks, and dropping `FIRELEFT` / `FIRERIGHT` is what keeps ~3,000 neighboring roads to 594 KB inside one document. Both the fetch and the save read that list, so the two can never disagree: the app cannot save a road layer with no names in it.

**The neighboring districts leave your own out.** The fetch asks the county for the beats layer with your department's `AgencyID` excluded, so your own beat is not downloaded at all — it is already drawn as the boundary. A boundary that arrived as an **uploaded file** has no agency to match, so the map drops the one polygon whose name equals the boundary's own label instead.

**The nearby roads are a separate document, and are NOT simply a bigger band.** Every county layer answers at most 2,000 records at a time and the app keeps a drawing under one 900 KB document, so the roads of a whole cluster of neighbors will not fit in the **roads** document beside yours. Measured against the real service, *every* road across the neighbors is about 1,119 KB (too big), so this layer keeps the **major roads only** — `SPEEDLIMIT >= 35`, the arterials and collectors a driver actually follows — which is ~3,000 roads and ~594 KB, and is exactly the class of road that means anything at district scale anyway. It is drawn thinner and paler than your own roads, so it reads as *"the way through and out"* rather than your own streets.

Three details make that fetch correct rather than a guess:

- **The neighbors' beats are fetched first**, by intersecting the band with the beats layer (your own department excluded) — one light, geometry-light request that yields the nine or so beats next door.
- **Each neighbor's roads are then fetched by that beat's own outline**, one polygon at a time, and merged with roads already seen de-duplicated by geometry. A single box or a single many-ringed polygon is **not** used: the county reads extra rings in a multipart polygon as *holes*, not as more ground, so one combined clip would return the wrong set — each beat is asked for on its own.
- **Their own lines are kept, not the band's.** A kilometer past each neighboring district is somebody else's *further* neighbor, which is not wanted; clipping to the beats' outlines keeps the ground the layer actually names.

## Landmarks

Landmarks are added **on the map**, not here, because placing one means pointing at where it is:

1. Open the **District map** module.
2. Press **Add landmark**, then press the map where the landmark is. A pin appears under your finger straight away, drawn in the color and icon of the type you have chosen, so you can see where it landed before you save it — **drag it** if it needs nudging, or press the map again to move it. (**Use my position** does the same from where you are standing.)
3. Give it a name, and pick its **type** from this station's own list (see below) — the picker shows each type's icon and color, because that is what the map will draw.
4. Press **Save landmark**.

Pressing a landmark in the list opens **Edit** and **Remove** for it. Editing includes moving it: press **Choose on map** and press the new place. Positions are stored to six decimal places, about 4 inches (11 cm), which is finer than the phone that placed them.

Removing one asks first, and never touches the boundary.

## Landmark types

The **Landmark types** card holds what a pin on the map can be: for each type, a **name**, an **icon** and a **color**. It is the map's legend, and it is yours — so a station that wants a pin for a dry hydrant, a fill site, an LZ or a gated access adds one rather than filing it all under *Other*.

The card ships with eight types already (hydrant, water source, boat ramp, staging area, access, hazard, station, other), and **Start again from the built-in eight** puts them back if a session goes wrong. Up to 24 types, because this is a legend rather than a list: a map with forty colors on it says nothing.

| On each row | What it does |
|---|---|
| The colored disk | Opens the icon picker — forty icons, from water and fire to gates, fuel, towers and boats |
| The name | What the legend calls it. Rename freely |
| **Color** | Opens the palette (16 colors, all readable on the pale map and the dark one) |
| The pin count | How many landmarks wear this type — the number that makes removing one an informed decision |
| **Remove** | Takes the type off the list. Any landmark still wearing it draws as *Other* until somebody gives it a new type, and the map says how many when it happens |

Two things worth knowing:

- **Renaming a type never moves or repaints a pin.** Every landmark remembers an internal key that the name was made from once, so *Hydrant* can become *Fire hydrant* and two hundred pins simply follow.
- **Nothing here takes effect on the map until somebody opens it again** — the types are read when the map opens, like the boundary and the pins, and are kept on the device so the map still draws its own colors with no signal.

## Who sees it

| Permission | Where it is granted | What it does |
|---|---|---|
| **View the district map** | *Roles* | The module in a member's sidebar, and their device may read the boundary and the landmarks |
| **Maintain the district map** | *Roles* | The one switch for the map's content: adding, moving and removing landmarks, and the two cards that set the boundary and fetch the county's own layers — the roads, the waterways, the flood zones and the districts around this one. **Opens System → Map Settings by itself** — no administrator rights needed. Requires *View* |
| **Manage system settings** | *Roles* | The station-wide settings, and the one card on this page that is not geometry: the uploaded drawing |

**Two permissions open this page, and which cards you get follows the permission the save needs.** Holding *Maintain the district map* shows the boundary and the background, and says who can upload the drawing; holding *Manage system settings* shows the drawing, and says the boundary needs the map permission. A card you cannot save is never drawn with a button that would be refused.

**A role created before this module existed has neither of the map permissions.** They read as *off*, so the map is hidden until somebody turns them on in *Roles* for each role that should have it. Administrators see it immediately either way.

## Where the county's data comes from

`bcgis.brunswickcountync.gov/arcgis/rest/services`, five layers across three services:

| Layer | What it gives |
|---|---|
| `Brunsco_Ops/FireBeats` | Every department's district boundary, with its beat number, abbreviation and zone — the boundary's own line, and the **neighboring districts** around it |
| `Mapping/DataViewer/4` (Roads) | The road network, each row carrying `FIRELEFT`/`FIRERIGHT` — the department covering each side of the road; asked twice, once clipped to your district for the **roads**, and once per neighboring outline for the **nearby roads** |
| `Basemaps/HydroBaseWebMercator/0` and `/1` | Streams and water bodies, which the app merges into one water layer |
| `Layers/FloodHazards/0` | FEMA's Special Flood Hazard Areas, one polygon per zone — the `AE`, `A`, `AO`, `VE` and shaded-X areas, which the map draws in FEMA's own colors |

It is public, needs no key, and the app asks it a question only when an officer presses **Look up** or **Fetch** — never at sign-in, and never from the screen a member opens. The county's own service is credited on the map, and everything it gives is copied into the station's records rather than linked.

**The nearby roads are the MAJOR roads out in the neighbors, and that is a measured limit rather than a preference.** Every road in every neighboring district — the subdivision lanes, the driveways, the dead ends — is 1,119 KB once the overlaps between neighboring outlines are merged away, which is past the 900 KB a single document can hold and would have to be split across documents that the read, the rules and the offline copy all fetch together. So the fetch asks the county for the roads worth showing at district scale (speed limit 35 and up, the arterials and collectors), and keeps just their names: 594 KB, which is about three thousand roads, in one document. Two facts from the county drive the shape of it. Its roads layer answers at most **2,000 rows a call**, so a single box around all nine neighbors silently truncates; and it reads a multi-ring clip as a shape with HOLES rather than as several districts at once, so each neighbor is asked for separately and the overlaps merged here. The result is drawn thin and gray under the boundary's own roads, switchable in **Map layers** like every other layer, and tapping one names the road — not who covers it, because those are somebody else's streets.
