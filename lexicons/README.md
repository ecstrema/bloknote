# Bloknote AT Protocol Lexicons

This directory defines the AT Protocol Lexicon schemas used by Bloknote under `org.bloknote.*` and the general-purpose `org.openstreetmap.*` namespace.

Note that the general-purpose `org.openstreetmap.*` namespace is not specific to Bloknote, and is intended for use by any application that wants to use the AT Protocol comment and review osm data.

`org.openstreetmap.review` (comment text and rating in one record) was split into `org.bloknote.comment` and `org.bloknote.rating` in #163. Existing review records are still read by the app, but new records only use the split collections.
