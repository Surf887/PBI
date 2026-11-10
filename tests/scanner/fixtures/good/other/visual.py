# Python visual: distribution of order values by region (box plot + points).
# Power BI supplies `dataset` (a pandas DataFrame of the fields in Values, de-duplicated).
# Rules: no network, no file writes, no installs, no subprocess; only service-supported packages.
import matplotlib.pyplot as plt

df = dataset.dropna(subset=["Region", "Order Value"])  # noqa: F821  (provided by Power BI)
if df.empty:
    fig, ax = plt.subplots(figsize=(6, 3.5))
    ax.text(0.5, 0.5, "No data for the current filters", ha="center", va="center", color="#605E5C")
    ax.axis("off")
else:
    order = df.groupby("Region")["Order Value"].median().sort_values(ascending=False).index.tolist()
    groups = [df.loc[df["Region"] == r, "Order Value"].to_numpy() for r in order]
    fig, ax = plt.subplots(figsize=(6, 3.5))
    ax.boxplot(groups, vert=False, showfliers=False, widths=0.5,
               medianprops={"color": "#118DFF", "linewidth": 2},
               boxprops={"color": "#605E5C"}, whiskerprops={"color": "#605E5C"}, capprops={"color": "#605E5C"})
    for i, g in enumerate(groups, start=1):  # light jitter of the raw points
        ax.scatter(g, [i + ((j % 7) - 3) * 0.03 for j in range(len(g))], s=6, alpha=0.35, color="#118DFF")
    ax.set_yticks(range(1, len(order) + 1), labels=order)
    ax.invert_yaxis()
    ax.set_xlabel("Order value")
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    ax.grid(axis="x", color="#EDEBE9")
fig.tight_layout()
plt.show()
