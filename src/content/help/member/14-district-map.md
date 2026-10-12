The station's district as a real map: the boundary line, and the landmarks your crew has pinned on it — hydrants, water sources, boat ramps, staging areas.

## What you are looking at

The red outline is **the county's official line for your fire district** rather than an estimate. It is drawn from real latitude and longitude, so it lands exactly where it belongs and stays sharp however far you zoom in.

Underneath it is the **county's own linework**, so you can see where the boundary runs against a road or a creek — the **roads**, the **waterways**, the **flood zones**, the **neighbouring districts** around yours, and the **nearby roads** that run out through them. They are drawn from the station's own copy of that linework, so they are there with no signal like everything else — and the **Layers** row above the map switches each one off if you would rather have a plainer map. **Landmarks** is a switch there too: turning the pins off is how you check where the boundary runs without two hundred dots in the way. It only changes what is drawn, so nothing is lost. The same row has a **Light / Dark** switch for the map itself: it starts the way you have the app set, and switching it only changes the map — handy when the rest of the app is dark but you want a bright map in daylight, or the reverse at night.

The roads and the neighbouring districts reach a kilometre **past** your boundary line, so you can see the far side of a road and whose ground is next door. Your own district is the solid red line; a neighbouring one is a dashed grey outline with its name printed in the middle of it — the name **is** the answer, so there is nothing to tap.

**The flood zones are drawn in the colour FEMA gives them** — the dark blue of an *AE* zone, the purple of an *A*, the yellow of the *Shaded X* (the 0.2% annual chance area, which is **not** a flood zone but still worth knowing about). Tap any of them and the map names the zone.

**Road names appear as you zoom in.** They are placed where they fit — nothing is printed at district scale, and the streets label themselves once you are close enough to be looking for one. The name lies along its road, so it reads the way a map's names read.

**Tap a road and it tells you who covers each side of it.** That is worth knowing at a district line, which often runs straight down the middle of a road: *GEORGE II HWY SE · WINNABOW FD BEAT 6A / Bolivia FD* means one side is yours and the other is not. The **nearby roads** out in the neighbouring districts are there so you can see the way through and out — tap one and it names the road, but not who covers it, because those are somebody else's streets.

The coloured dots are **landmarks** — places somebody in the station pinned because they matter. Each kind has its own color, and the legend under the map shows only the kinds your station actually uses.

| To do this | Do this |
|---|---|
| Move the map | Drag it, or swipe with one finger |
| Zoom in | Pinch out, scroll up, or double-click |
| Zoom out | Pinch in, or scroll down |
| Go back to the whole district | Press **Reset view** |
| Find a landmark | Press its name in the list below the map — the map moves to it |

Hovering over a dot (or tapping it) gives its name; pressing it marks it in the list, where its full note is.

> [!NOTE]
> **This map works with no signal.** The boundary and the landmarks are kept on your device after the first look, and no map tiles are fetched from anywhere — the district is drawn by the app itself. That is why it opens instantly in a truck with no bars, and why it does not stop working when somebody else's website does.

There is a second view called **Drawing**, which shows a picture of a map if your department has uploaded one. It is a drawing and not a map: it carries no coordinates, so landmarks cannot be pinned on it. Your station's real information lives on the district view.

Landmarks are placed by whoever maintains the map, from this same screen. If you hold **Maintain the district map**, **Add landmark** followed by a press on the map drops a pin where you pressed — a pin appears under your finger as soon as you let go, so you can see where it landed, and you can drag that pin if it wants nudging. **Use my position** will do it from where you are standing.

**Every pin wears a type**, and a type is a name, an icon and a color. The types are chosen by your station rather than fixed by the app — so a pin for a hydrant, a dry hydrant, a fill site or a gate each look like themselves, and the legend under the map is your station's own words. Picking a type is part of adding a landmark, and the picker shows each one the way the map will draw it.

## Who can see it

Two permissions, granted per role in *Administration → Roles*:

| Permission | What it gives |
|---|---|
| **View the district map** | The module in your sidebar, and the boundary and landmarks with it |
| **Maintain the district map** | Adding, editing and removing landmarks |

If the module is not in your sidebar it is not a fault: a district boundary is not everybody's business, and the station decides which roles need it.

## If the map is empty

If it says **No district boundary yet**, nobody has set one. An officer can do it in a moment from *Administration → System → Map Settings* — the county publishes your department's own beat, so it is usually a matter of searching for the station's name and saving it.

## Keeping it current

The boundary and the background are both **copies**, taken once from the county's open data and kept in the station's own records. That is what makes the map work with no signal and what stops somebody else's server from being a single point of failure — which also means they do not update themselves. The county redraws its beats about once a year, so an officer refreshing the boundary and the background once a year keeps the map right, from *Administration → System → Map Settings*.
