import React, { useEffect, useState } from "react";
import { NexoButton, NexoInput, useApi } from "@nexo-alpha/frontend";
import type { ProductPage } from "./product.js";

const PAGE_SIZE = 20;

export function ProductsPage(): React.JSX.Element {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (search !== "") params.set("search", search);
  const products = useApi<ProductPage>(`/api/products?${params.toString()}`);
  const total = products.data?.total ?? 0;

  return (
    <div>
      <NexoInput type="search" placeholder="Search products…" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
      {products.error ? (
        <p role="alert">
          {products.error.message}
          <NexoButton onClick={() => void products.refetch()}>Try again</NexoButton>
        </p>
      ) : products.loading && products.data === null ? (
        <p>Loading…</p>
      ) : total === 0 ? (
        <p>{search === "" ? "No products yet" : `No products match "${search}"`}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Price</th>
              <th>Category</th>
            </tr>
          </thead>
          <tbody>
            {products.data?.items.map((product) => (
              <tr key={product.id}>
                <td>{product.name}</td>
                <td>{product.price}</td>
                <td>{product.category}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {total > PAGE_SIZE && (
        <div>
          <span>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <NexoButton disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            Previous
          </NexoButton>
          <NexoButton disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
            Next
          </NexoButton>
        </div>
      )}
    </div>
  );
}
