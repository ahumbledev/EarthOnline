# Geographic data

The district datasets under `public/maps` contain editable street lines and building footprints in local metres. Each file identifies its WGS84 origin as longitude and latitude. Positive X points east and positive Z points south. The scene uses a level ground plane. Footprints are clipped to the displayed district. Street widths and untagged building heights include estimates. The maps are intended for exploration and cannot be used for navigation or surveying.

## Sources and distribution terms

| City | Included landscape | Sources and terms |
| --- | --- | --- |
| Philadelphia | Center City building massing, streets, paths and parks | Buildings from the [City of Philadelphia Building Footprints](https://services.arcgis.com/fLeGjb7u4uXqeF9q/ArcGIS/rest/services/building_footprints/FeatureServer/0), subject to the [City GIS terms](public/maps/notices/philadelphia-gis.txt). Map roads, paths and parks © OpenStreetMap contributors, ODbL 1.0. |
| Hong Kong | Mong Kok, Yau Ma Tei and the Tsim Sha Tsui waterfront, including the Victoria Harbour shoreline | © OpenStreetMap contributors, ODbL 1.0. |
| Tokyo | Shibuya, Akihabara Chuo-dori, Kabukicho and Ueno Ameyoko street networks, buildings and green spaces | © OpenStreetMap contributors, ODbL 1.0. |
| Montréal | Streets, paths, buildings and green spaces in Old Montréal | © OpenStreetMap contributors, ODbL 1.0. |
| Melbourne | CBD structure footprints, carriageways and nature strips | © City of Melbourne, [2018 Building Footprints](https://data.melbourne.vic.gov.au/explore/dataset/2018-building-footprints/information/) and [Road Segments with Surface Type](https://data.melbourne.vic.gov.au/explore/dataset/road-segments-with-surface-type/information/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). |
| Helsinki | Central and south Helsinki, including Punavuori, with buildings, green surfaces, roads and paths | © City of Helsinki, building register and YLRE public-area surfaces, [open geospatial data](https://www.hel.fi/en/decision-making/information-on-helsinki/maps-and-geospatial-data), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Streets and paths © OpenStreetMap contributors, ODbL 1.0. |

OpenStreetMap-derived data layers in these JSON downloads are distributed under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). The local projections, clipped boundaries, coordinate rounding, street-width estimates and simplified footprints are included in editable form. The City of Philadelphia and City of Helsinki layers retain their respective terms. [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright)

Melbourne footprints use the lowest recorded tier for horizontal coverage and the building's overall relative height for massing. Carriageway polygons are retained as `roadAreas`. Their approximate centre axes also appear as line segments. The surface data uses a simplified two-dimensional representation.

The browser exposes [map credits](public/maps/credits.html) alongside the scene.

Philadelphia City Hall uses the City’s footprint and courtyards. The clock tower, roof, portals and ornament are architectural interpretations. Its colour, normal and roughness textures derive from ambientCG’s Marble005 with JPEG conversion and a roughness adjustment. [Marble005](https://ambientcg.com/view?id=Marble005) · [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
