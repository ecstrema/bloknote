# Bloknote AT Protocol Lexicons

This directory defines the AT Protocol Lexicon schemas used by Bloknote under `org.bloknote.*`.

The OSM-specific schemas (`org.bloknote.osm.defs#elementRef`, `org.bloknote.osm.comment`, `org.bloknote.osm.rating`, `org.bloknote.osm.bookmark`, `org.bloknote.osm.opinion`) are not specific to Bloknote: any application can use them to attach comments, ratings, bookmarks and field opinions to OSM elements. They live under `org.bloknote.*` because a Lexicon namespace is tied to the DNS domain that publishes it, so `org.openstreetmap.*` schemas could only be published by the OpenStreetMap Foundation.
