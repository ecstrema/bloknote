# Bloknote AT Protocol Lexicons

This directory defines the AT Protocol Lexicon schemas used by Bloknote under `org.bloknote.*`.

The OSM-specific schemas (`org.bloknote.osm.defs#elementRef`, `org.bloknote.comment`, `org.bloknote.rating`, `org.bloknote.bookmark`) are not specific to Bloknote: any application can use them to attach comments, ratings and bookmarks to OSM elements. They live under `org.bloknote.*` because a Lexicon namespace is tied to the DNS domain that publishes it, so `org.openstreetmap.*` schemas could only be published by the OpenStreetMap Foundation.

Legacy collections, still read by the app but no longer written:

- `org.openstreetmap.review` (comment text and rating in one record), split into `org.bloknote.comment` and `org.bloknote.rating` in #163.
- `org.openstreetmap.star`, renamed to `org.bloknote.bookmark`.
