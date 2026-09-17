# Census reference

`shelby-block-groups-2024.json.gz` contains public U.S. Census Bureau data for Shelby County, Tennessee (state 47, county 157). It contains no captured outage data.

- Population: 2020–2024 ACS five-year estimates, B01003 total population and 90% margin of error. [Official table](https://data.census.gov/table/ACSDT5Y2024.B01003), [release schedule](https://www.census.gov/programs-surveys/acs/news/data-releases/2024/release-schedule.html).
- Download: [official B01003 table-based summary file](https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b01003.dat). Only `1500000US47157…` block groups are included. Negative Census special values are preserved as unavailable, not zero. Estimates are five-year survey estimates, not current population counts.
- Boundaries: [TIGERweb ACS 2024 Census Block Groups, layer 10](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2024/MapServer/10). January 1, 2024 vintage, WGS84 output with six decimal places; no generalized display geometry is used for assignment.
- Join: exact 12-digit GEOID. All 685 population records match all 685 polygons without duplicates; their estimates sum to the published county estimate of 919,173. Five areas have no positive population denominator.

Both original response URLs, UTC retrieval times, byte sizes and SHA-256 hashes are stored in the file's `metadata.sources`. Original downloads are under ignored `data/census/`. `scripts/prepare-census.mjs` verifies those hashes, schemas, exact geography matches and county reconciliation before building the compressed reference. Run with `--download` to retrieve the same pinned official sources again. Dataset vintage changes require reviewing population and boundaries together.

This reference is stored locally for reproducible, offline joins. Exact-edge points and overlapping/ambiguous assignments are left unassigned. Utility accounts associated with an outage point may lie outside its Census block group; normalized customer counts are a location-based proxy, never a resident outage percentage.
