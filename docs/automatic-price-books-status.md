# Price books and inventory valuation status

The initial three-book design and migrations 0126/0127 were delivered first. The subsequent pricing workflow supersedes that arrangement: cost, latest net purchase, an independently maintained company list price, and retail are separate sources. Price-book behavior is documented in `docs/pricing-workflow.md`.

The historical transition decision was then refined by the user: use the confirmed replacement invoice, skip historical evidence that cannot be supplied, and treat historical inbound freight as zero. Available, reconciled history determines supported costs. Unsupported history retains current declared cost as the prospective opening balance; prior COGS is not certified by this choice.

Migration 0128 introduces prospective weighted-average replay. Receipt writes now use allocated landed cost, and edits/cancellations replay affected products from their retained baseline. Historical receipt value/quantity edits are protected while metadata/payment edits preserve original source rounding. See `docs/inventory-cost-replay.md` for runtime and recovery details.

The reviewed KiotViet document/stock delta has been applied and its scoped replay is zero-diff. Payment-only changes remain deferred for coordinated financial reconciliation. Raw source files, exact identities, financial amounts, hashes and before/after data remain in local `tmp/price-cost-reconciliation/` audit artifacts and are not published in this repository.

The reviewed valuation transition has also been applied. Supported historical costs and source-backed raw gross prices are now stored; unsupported and local-only costs are preserved. Prospective baselines match final product quantities and costs, and protected stock, cash/debt, receipt and independent price-book rows were verified unchanged.
