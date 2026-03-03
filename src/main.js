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

<input id="product" placeholder="SKU prodotto">

<input id="qty" type="number" placeholder="Quantità">

<button id="save">Salva movimento</button>

</div>

<div class="panel">

<h2>Storico movimenti</h2>

<table>
<thead>
<tr>
<th>Data</th>
<th>Tipo</th>
<th>Prodotto</th>
<th>Quantità</th>
</tr>
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
const product = document.querySelector("#product").value;
const qty = Number(document.querySelector("#qty").value);

movements.push({
date: new Date().toISOString(),
type,
product,
qty
});

localStorage.setItem("movements", JSON.stringify(movements));

render();

};

function render(){

rows.innerHTML = "";

movements.forEach(m => {

rows.innerHTML += `
<tr>
<td>${new Date(m.date).toLocaleString()}</td>
<td>${m.type}</td>
<td>${m.product}</td>
<td>${m.qty}</td>
</tr>
`;

});

}
