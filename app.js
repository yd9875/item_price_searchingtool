const els = {
  form: document.querySelector("#searchForm"),
  keyword: document.querySelector("#keyword"),
  searchButton: document.querySelector("#searchButton"),
  shippingMode: document.querySelector("#shippingMode"),
  dynamicFilters: document.querySelector("#dynamicFilters"),
  typeFilters: document.querySelector("#typeFilters"),
  packageFilters: document.querySelector("#packageFilters"),
  coupangLink: document.querySelector("#coupangLink"),
  searchStatus: document.querySelector("#searchStatus"),
  totalCount: document.querySelector("#totalCount"),
  bestUnitPrice: document.querySelector("#bestUnitPrice"),
  sortMode: document.querySelector("#sortMode"),
  loadingState: document.querySelector("#loadingState"),
  results: document.querySelector("#results"),
  template: document.querySelector("#resultTemplate"),
};

let activeType = "all";
let activePackage = "all";
let remoteRows = [];
let searchInFlight = false;

function formatWon(value) {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function normalizeQuantity(row) {
  const quantity = Number(row.quantityValue);
  if (!(quantity > 0)) return { baseQuantity: 0, basisAmount: 0, basisLabel: "" };

  const conversions = {
    ml: { baseQuantity: quantity, basisAmount: 100, basisLabel: "100ml당" },
    l: { baseQuantity: quantity * 1000, basisAmount: 100, basisLabel: "100ml당" },
    g: { baseQuantity: quantity, basisAmount: 100, basisLabel: "100g당" },
    kg: { baseQuantity: quantity * 1000, basisAmount: 100, basisLabel: "100g당" },
    ea: { baseQuantity: quantity, basisAmount: 1, basisLabel: "1개당" },
    m: { baseQuantity: quantity, basisAmount: 1, basisLabel: "1m당" },
    cm: { baseQuantity: quantity / 100, basisAmount: 1, basisLabel: "1m당" },
  };
  return conversions[row.quantityUnit] || { baseQuantity: 0, basisAmount: 0, basisLabel: "" };
}

function enrich(row) {
  const quantity = normalizeQuantity(row);
  const totalPrice =
    els.shippingMode.value === "include" ? row.price + (row.shipping || 0) : row.price;
  const denominator =
    quantity.baseQuantity > 0 ? quantity.baseQuantity / quantity.basisAmount : 0;
  const unitPrice = denominator > 0 ? totalPrice / denominator : Infinity;

  return {
    ...row,
    productType: row.productType || "기타",
    packageLabel: row.packageLabel || "구성 미확인",
    ...quantity,
    totalPrice,
    unitPrice,
  };
}

function allRows() {
  return remoteRows.map(enrich);
}

function filterRows(rows) {
  return rows.filter(
    (row) =>
      (activeType === "all" || row.productType === activeType) &&
      (activePackage === "all" || row.packageLabel === activePackage)
  );
}

function sortRows(rows) {
  const sorters = {
    unitAsc: (a, b) => a.unitPrice - b.unitPrice,
    totalAsc: (a, b) => a.totalPrice - b.totalPrice,
    quantityDesc: (a, b) => b.baseQuantity - a.baseQuantity,
  };
  return [...rows].sort(sorters[els.sortMode.value]);
}

function buildFilterButtons(container, rows, field, activeValue, onSelect) {
  const counts = new Map();
  rows.forEach((row) => counts.set(row[field], (counts.get(row[field]) || 0) + 1));
  const values = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  container.innerHTML = "";

  [["all", "전체", rows.length], ...values.map(([value, count]) => [value, value, count])].forEach(
    ([value, label, count]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "filter-chip";
      button.classList.toggle("active", value === activeValue);
      button.setAttribute("aria-pressed", String(value === activeValue));
      button.textContent = `${label} ${count}`;
      button.addEventListener("click", () => onSelect(value));
      container.append(button);
    }
  );
}

function renderDynamicFilters(rows) {
  const types = new Set(rows.map((row) => row.productType));
  if (activeType !== "all" && !types.has(activeType)) activeType = "all";

  els.dynamicFilters.hidden = rows.length === 0;
  if (!rows.length) return;

  const packageRows =
    activeType === "all" ? rows : rows.filter((row) => row.productType === activeType);
  const packages = new Set(packageRows.map((row) => row.packageLabel));
  if (activePackage !== "all" && !packages.has(activePackage)) activePackage = "all";

  buildFilterButtons(els.typeFilters, rows, "productType", activeType, (value) => {
    activeType = value;
    activePackage = "all";
    renderResults();
  });
  buildFilterButtons(
    els.packageFilters,
    packageRows,
    "packageLabel",
    activePackage,
    (value) => {
      activePackage = value;
      renderResults();
    }
  );
}

function renderSummary(rows) {
  const valid = rows.filter((row) => Number.isFinite(row.unitPrice));
  const basisLabels = new Set(valid.map((row) => row.basisLabel));
  els.totalCount.textContent = rows.length.toLocaleString("ko-KR");

  if (!valid.length) {
    els.bestUnitPrice.textContent = "-";
    return;
  }

  if (basisLabels.size > 1) {
    els.bestUnitPrice.textContent = "종류를 선택하세요";
    return;
  }

  els.bestUnitPrice.textContent = `${formatWon(valid[0].unitPrice)} / ${valid[0].basisLabel}`;
}

function formatTotalQuantity(row) {
  const value = Number(row.quantityValue);
  if (!(value > 0)) return "총수량 미확인";
  const labels = { ml: "ml", l: "L", g: "g", kg: "kg", ea: "개", m: "m", cm: "cm" };
  return `총 ${value.toLocaleString("ko-KR")}${labels[row.quantityUnit] || ""}`;
}

function renderResults() {
  const enrichedRows = allRows();
  renderDynamicFilters(enrichedRows);
  const rows = sortRows(filterRows(enrichedRows));
  renderSummary(rows);
  els.results.innerHTML = "";

  if (!rows.length) {
    els.results.innerHTML =
      '<div class="empty">상품을 검색하면 묶음 구성과 단가를 분석합니다.</div>';
    return;
  }

  rows.forEach((row, index) => {
    const node = els.template.content.firstElementChild.cloneNode(true);
    node.querySelector(".rank").textContent = index + 1;
    const source = node.querySelector(".source");
    source.textContent = "쿠팡";
    source.classList.add("coupang");

    const title = node.querySelector("h3");
    const titleNode = row.url ? document.createElement("a") : document.createElement("span");
    titleNode.textContent = row.title;
    if (row.url) {
      titleNode.href = row.url;
      titleNode.target = "_blank";
      titleNode.rel = "noreferrer";
    }
    title.append(titleNode);

    node.querySelector(".unit-price").textContent = Number.isFinite(row.unitPrice)
      ? `${formatWon(row.unitPrice)} / ${row.basisLabel}`
      : "단가 확인 필요";
    node.querySelector(".total-price").textContent = `총 ${formatWon(row.totalPrice)}${
      row.shipping ? ` · 배송 ${formatWon(row.shipping)}` : ""
    }`;

    const facts = [row.productType, row.packageLabel, formatTotalQuantity(row)];
    node.querySelector(".facts").innerHTML = facts
      .map((fact) => `<span>${fact}</span>`)
      .join("");
    els.results.append(node);
  });
}

function updateSearchLinks() {
  const keyword = els.keyword.value.trim();
  const query = encodeURIComponent(keyword);
  els.coupangLink.href = keyword
    ? `https://www.coupang.com/np/search?q=${query}`
    : "https://www.coupang.com/";
}

function setSearching(isSearching) {
  searchInFlight = isSearching;
  els.form.setAttribute("aria-busy", String(isSearching));
  els.results.setAttribute("aria-busy", String(isSearching));
  els.searchButton.disabled = isSearching;
  els.searchButton.classList.toggle("loading", isSearching);
  els.searchButton.textContent = isSearching ? "검색 중" : "검색";
  els.loadingState.hidden = !isSearching;
  els.results.hidden = isSearching;
}

async function searchWeb() {
  if (searchInFlight) return;

  const keyword = els.keyword.value.trim();
  if (!keyword) {
    els.searchStatus.textContent = "검색어를 입력해주세요.";
    els.keyword.focus();
    return;
  }

  updateSearchLinks();
  els.searchStatus.textContent = "GPT-5.6 Sol이 쿠팡을 웹 검색하는 중...";
  remoteRows = [];
  activeType = "all";
  activePackage = "all";
  renderResults();
  setSearching(true);

  if (location.protocol === "file:") {
    els.searchStatus.textContent =
      "npm start로 서버를 실행한 뒤 http://localhost:5173에서 검색해주세요.";
    setSearching(false);
    return;
  }

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(keyword)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "검색 실패");
    remoteRows = data.items || [];
    els.searchStatus.textContent = remoteRows.length
      ? `GPT-5.6 Sol 웹 검색으로 ${remoteRows.length}개 상품을 분석했습니다.`
      : "웹 검색에서 가격이 확인된 상품을 찾지 못했습니다.";
  } catch (error) {
    remoteRows = [];
    els.searchStatus.textContent = `OpenAI 웹 검색 실패: ${error.message}`;
  } finally {
    setSearching(false);
  }

  renderResults();
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  searchWeb();
});

els.shippingMode.addEventListener("change", renderResults);
els.sortMode.addEventListener("change", renderResults);

updateSearchLinks();
renderResults();
