# Automatic library albums

The library can include existing product and construction photos without copying
objects or inserting manual library items. Source associations are queried live
when listing or refreshing the library. Newly attached photos appear on the next
read; removing the source association removes them from subsequent reads.

## Albums and sources

| Preset key | Vietnamese name | Source |
| --- | --- | --- |
| `products` | Hàng hóa | Direct active `product_media` associations and supported legacy product image URLs |
| `camera` | Thi công camera | Camera project, job and installed-asset photos |
| `electrical` | Thi công điện | Electrical project, job and installed-asset photos |
| `plumbing` | Thi công nước | Plumbing project, job and installed-asset photos |
| `mixed` | Thi công tổng hợp | Construction photos without an unambiguous trade |

A linked job's concrete service type takes precedence over its project. An
installed asset can inherit its linked job's type. Otherwise a concrete project
type is used; mixed/unclassified photos are not classified by filename. Claim,
customer-request and signature attachments are excluded. Handover documents are
not independently indexed: their project/job photo attachments remain the source.

Presets are returned even with zero photos when the viewer can access that source
category. They cannot be chosen as upload destinations. A manually created album
with the same display name remains a separate album.

## API compatibility

New clients opt into the combined list with `includeSources=1`. Older clients keep
the manual-only list. The `source` filter accepts one preset key and requires the
opt-in; `album` continues to mean an exact manual album name. Supplying both
filters is invalid. Search, kind filtering, totals and keyset pagination apply
after source authorization.

Manual item IDs remain UUIDs. Linked item IDs identify the source association:
`pm:<relation UUID>`, `pu:<product UUID>:<URL digest>`, or `sa:<attachment UUID>`.
Resolve/open and metadata reads check the current association and actor again;
clients must discard a previously displayed URL when resolution is denied.

Source items are read-only in the library. Per-item `canDelete` and
`canExtractMetadata` control available actions; absent source capabilities default
to false. Existing UUID-only manual update/delete paths reject source coordinates.

## Access, storage and metadata

- Product photos follow stock read roles, including cashiers, excluding technicians.
- Construction photos require field services. Owners/managers can read them;
  technicians retain project-assignment and exact-job assignment restrictions.
- Installed-asset photos retain their existing manager-only access boundary.
- Private objects retain short-lived signed URLs. Legacy public product URLs are
  rendered directly and never fetched by the server for metadata extraction.
- Library storage usage still counts only manual library objects. Linked photos
  do not add bytes; list totals count visible references, not unique stored objects.
- Original construction metadata is reused. Unknown legacy product size, MIME
  subtype and upload time remain explicitly unknown; product update time is only an ordering key,
  not a claimed upload or capture time.

No schema migration or background copying job is required.
