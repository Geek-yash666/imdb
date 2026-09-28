import { apiRequestGraphQL } from "./apiRequestRawHtml";
import seriesFetcher from "./seriesFetcher";

const TITLE_QUERY = `
  query TitleInfo($id: ID!) {
    title(id: $id) {
      id
      titleText {
        text
      }
      titleType {
        id
        text
        isSeries
        isEpisode
      }
      certificate {
        rating
      }
      primaryImage {
        url
        width
        height
      }
      images(first: 20) {
        edges {
          __typename
          node {
            url
          }
        }
      }
      plot {
        plotText {
          plainText
        }
      }
      runtime {
        seconds
        displayableProperty {
          value {
            plainText
          }
        }
      }
      ratingsSummary {
        aggregateRating
        voteCount
      }
      nominations(first: 0) {
        total
      }
      prestigiousAwardSummary {
        wins
        nominations
      }
      genres {
        genres {
          id
          text
        }
      }
      releaseDate {
        day
        month
        year
        country {
          id
          text
        }
      }
      productionStatus {
        currentProductionStage {
          id
          text
        }
      }
      principalCredits {
        category {
          id
          text
        }
        credits(limit: 10) {
          name {
            id
            nameText {
              text
            }
          }
        }
      }
      countriesOfOrigin {
        countries {
          id
          text
        }
      }
      spokenLanguages {
        spokenLanguages {
          id
          text
        }
      }
      filmingLocations(first: 10) {
        edges {
          node {
            text
          }
        }
      }
    }
  }
`;

export default async function getTitle(id) {
  const data = await apiRequestGraphQL(TITLE_QUERY, { id });

  const title = data?.title;
  if (!title) {
    throw new Error("Title not found on IMDb.");
  }

  const getCredits = (lookFor, v) => {
    const result = title.principalCredits?.find(
      (e) => e?.category?.id === lookFor
    );

    return result
      ? result.credits.map((e) => {
          if (v === "2")
            return {
              id: e?.name?.id,
              name: e?.name?.nameText?.text ?? "",
            };

          return e?.name?.nameText?.text ?? "";
        })
      : [];
  };

  // Calculate wins: total nominations minus non-winning nominations,
  // or use prestigiousAwardSummary wins as a fallback
  const totalNominations = title.nominations?.total ?? 0;
  const prestigiousWins = title.prestigiousAwardSummary?.wins ?? 0;

  return {
    id: id,
    review_api_path: `/reviews/${id}`,
    imdb: `https://www.imdb.com/title/${id}`,
    contentType: title.titleType?.id ?? "unknown",
    contentRating: title.certificate?.rating ?? "N/A",
    isSeries: title.titleType?.isSeries ?? false,
    productionStatus:
      title.productionStatus?.currentProductionStage?.id ?? "unknown",
    isReleased:
      title.productionStatus?.currentProductionStage?.id === "released",
    title: title.titleText?.text ?? "Untitled",

    // Safely check for primary image
    image: title.primaryImage?.url ?? null,

    // Safely map additional images
    images: title.images?.edges
      ? title.images.edges
          .filter((e) => e.__typename === "ImageEdge")
          .map((e) => e.node?.url)
      : [],

    // Safely fall back if plot is missing
    plot: title.plot?.plotText?.plainText ?? "No plot available yet.",

    runtime:
      title.runtime?.displayableProperty?.value?.plainText ?? "",
    runtimeSeconds: title.runtime?.seconds ?? 0,
    rating: {
      count: title.ratingsSummary?.voteCount ?? 0,
      star: title.ratingsSummary?.aggregateRating ?? 0,
    },
    award: {
      wins: prestigiousWins,
      nominations: totalNominations,
    },
    genre: title.genres?.genres?.map((e) => e.id) ?? [],
    releaseDetailed: {
      date: title.releaseDate
        ? new Date(
            title.releaseDate.year,
            (title.releaseDate.month || 1) - 1,
            title.releaseDate.day || 1
          ).toISOString()
        : null,
      day: title.releaseDate?.day ?? null,
      month: title.releaseDate?.month ?? null,
      year: title.releaseDate?.year ?? null,
      releaseLocation: {
        country: title.releaseDate?.country?.text ?? null,
        cca2: title.releaseDate?.country?.id ?? null,
      },
      originLocations: title.countriesOfOrigin?.countries?.map(
        (e) => ({
          country: e.text,
          cca2: e.id,
        })
      ) ?? [],
    },
    year: title.releaseDate?.year ?? null,
    spokenLanguages: title.spokenLanguages?.spokenLanguages?.map(
      (e) => ({
        language: e.text,
        id: e.id,
      })
    ) ?? [],
    filmingLocations: title.filmingLocations?.edges?.map(
      (e) => e.node?.text
    ) ?? [],
    actors: getCredits("cast"),
    actors_v2: getCredits("cast", "2"),
    creators: getCredits("creator"),
    creators_v2: getCredits("creator", "2"),
    directors: getCredits("director"),
    directors_v2: getCredits("director", "2"),
    writers: getCredits("writer"),
    writers_v2: getCredits("writer", "2"),
    top_credits: title.principalCredits?.map((e) => ({
      id: e?.category?.id,
      name: e?.category?.text,
      credits: e?.credits?.map((c) => c?.name?.nameText?.text) ?? [],
    })) ?? [],
    ...(title.titleType?.isSeries
      ? await seriesFetcher(id)
      : {}),
  };
}
