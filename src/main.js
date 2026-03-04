import "./style.css";

const app = document.querySelector("#app");

app.innerHTML = `
  <div class="container">
    <h1>Gestione Magazzino</h1>

    <div class="panel">
      <h2>Nuovo movimento</h2>

      <select id="type">
        <option value="IN">Carico</option>
        <option value="OUT">Scarico</option>
      </select>

      <input id="product" placeholder="SKU prodotto" />
      <input id="qty" type="number" placeholder="Quantità" value="1" />

      <button id="save">Salva movimento</button>
    </div>

    <div class="panel">
      <h2>Storico movimenti</h2>
      <table>
        <thead>
          <tr><th>Data</th><th>Tipo</th><th>SKU</th><th>Q.tà</th></tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
  </div>
`;

const rows = document.querySelector("#rows");
const movements = JSON.parse(localStorage.getItem("movements") || "[]");

render();

document.querySelector("#save").onclick = () => {
  const type = document.querySelector("#type").value;
  const product = document.querySelector("#product").value.trim();
  const qty = Number(document.querySelector("#qty").value);

  if (!product) return alert("Inserisci uno SKU");
  if (!Number.isFinite(qty) || qty === 0) return alert("Quantità non valida");

  movements.push({ date: new Date().toISOString(), type, product, qty });
  localStorage.setItem("movements", JSON.stringify(movements));

  document.querySelector("#product").value = "";
  document.querySelector("#qty").value = "1";
  render();
};

function render() {
  rows.innerHTML = movements
    .slice()
    .reverse()
    .map(
      (m) => `
        <tr>
          <td>${new Date(m.date).toLocaleString("it-IT")}</td>
          <td>${m.type}</td>
          <td>${m.product}</td>
          <td>${m.qty}</td>
        </tr>
      `
    )
    .join("");
}
