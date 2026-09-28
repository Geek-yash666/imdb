import { apiRequestGraphQL } from "./apiRequestRawHtml";

const EPISODES_QUERY = `
  query EpisodesList($id: ID!, $first: Int!, $season: String!) {
    title(id: $id) {
      titleText {
        text
      }
      episodes {
        seasons {
          number
        }
        episodes(first: $first, filter: { includeSeasons: [$season] }) {
          edges {
            node {
              id
              titleText {
                text
              }
              plot {
                plotText {
                  plainText
                }
              }
              primaryImage {
                url
                caption {
                  plainText
                }
              }
              releaseDate {
                day
                month
                year
              }
              ratingsSummary {
                aggregateRating
                voteCount
              }
              series {
                episodeNumber {
                  episodeNumber
                  seasonNumber
                }
              }
            }
          }
        }
      }
    }
  }
`;

export default async function seriesFetcher(id) {
  try {
    const firstSeason = await getSeason({ id, seasonId: 1 });

    return {
      all_seasons: firstSeason.all_seasons,
      seasons: [
        {
          ...firstSeason,
          all_seasons: undefined,
        },
      ],
    };
  } catch (error) {
    return {
      all_seasons: [],
      seasons: [],
    };
  }
}

export async function getSeason({ id, seasonId }) {
  const seasonStr = String(seasonId);

  const data = await apiRequestGraphQL(EPISODES_QUERY, {
    id,
    first: 100,
    season: seasonStr,
  });

  const titleData = data?.title;
  if (!titleData) {
    throw new Error("Title not found on IMDb.");
  }

  const episodesData = titleData.episodes;
  if (!episodesData) {
    throw new Error("No episodes data found for this title.");
  }

  const seasons = episodesData.seasons || [];
  const episodeEdges = episodesData.episodes?.edges || [];

  const episodes = episodeEdges.map((edge, i) => {
    const e = edge.node;
    const epNum = e.series?.episodeNumber?.episodeNumber ?? i + 1;

    let publishedDate = null;
    try {
      if (e.releaseDate?.year && e.releaseDate?.month && e.releaseDate?.day) {
        publishedDate = new Date(
          e.releaseDate.year,
          e.releaseDate.month - 1,
          e.releaseDate.day
        ).toISOString();
      }
    } catch (_) {}

    return {
      idx: i + 1,
      no: epNum,
      title: e.titleText?.text ?? "",
      image: e.primaryImage?.url ?? null,
      image_large: e.primaryImage?.url ?? null,
      image_caption: e.primaryImage?.caption?.plainText ?? null,
      plot: e.plot?.plotText?.plainText ?? "",
      publishedDate,
      rating: {
        count: e.ratingsSummary?.voteCount ?? 0,
        star: e.ratingsSummary?.aggregateRating ?? 0,
      },
    };
  });

  return {
    name: titleData.titleText?.text ?? "",
    episodes,
    all_seasons: seasons.map((s) => ({
      id: s.number,
      name: `Season ${s.number}`,
      api_path: `/title/${id}/season/${s.number}`,
    })),
  };
}
