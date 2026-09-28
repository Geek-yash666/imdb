export default async function apiRequestRawHtml(url) {
  let data = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      accept: "text/html",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  let text = await data.text();
  return text;
}

export async function apiRequestJson(url) {
  let data = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      accept: "text/html",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  let text = await data.json();
  return text;
}

export async function apiRequestGraphQL(query, variables = {}) {
  const response = await fetch("https://graphql.imdb.com", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
      "x-imdb-client-name": "imdb-web-next-v1",
      "x-imdb-user-language": "en-US",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`IMDb GraphQL request failed with status ${response.status}`);
  }

  const data = await response.json();

  if (data.errors && data.errors.length > 0) {
    throw new Error(`IMDb GraphQL error: ${data.errors[0].message}`);
  }

  return data.data;
}
