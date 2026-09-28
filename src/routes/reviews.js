import { Hono } from "hono";
import DomParser from "dom-parser";
import { decode as entityDecoder } from "html-entities";
import apiRequestRawHtml, { apiRequestGraphQL } from "../helpers/apiRequestRawHtml";

const reviews = new Hono();

const REVIEWS_QUERY = `
  query TitleReviews($id: ID!, $first: Int) {
    title(id: $id) {
      reviews(first: $first) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            author {
              nickName
              userId
            }
            summary {
              originalText
            }
            text {
              originalText {
                plainText
              }
            }
            authorRating
            submissionDate
            helpfulness {
              upVotes
              totalVotes
            }
          }
        }
      }
    }
  }
`;

reviews.get("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    let option = optionsMapper[0];
    try {
      let getOption = optionsMapper.find(
        (option) => option.name === c.req.query("option")
      );
      if (getOption) option = getOption;
    } catch (_) {}

    let sortOrder = c.req.query("sortOrder") === "asc" ? "asc" : "desc";
    let nextKey = c.req.query("nextKey");

    let parsedReviews = [];
    let nextApiPath = null;

    // -------------------------------------------------------------
    // Strategy 1: Fetch raw HTML & parse __NEXT_DATA__ / ld+json
    // -------------------------------------------------------------
    let targetUrl = nextKey
      ? `https://www.imdb.com/title/${id}/reviews/_ajax?sort=${option.key}&dir=${sortOrder}&paginationKey=${nextKey}`
      : `https://www.imdb.com/title/${id}/reviews?sort=${option.key}&dir=${sortOrder}`;

    let rawHtml = await apiRequestRawHtml(targetUrl);

    if (
      !rawHtml ||
      (!rawHtml.includes("imdb-user-review") &&
        !rawHtml.includes("lister-item") &&
        !rawHtml.includes("__NEXT_DATA__") &&
        !rawHtml.includes("application/ld+json"))
    ) {
      let fallbackUrl = `https://www.imdb.com/title/${id}/reviews/`;
      let fallbackHtml = await apiRequestRawHtml(fallbackUrl);
      if (fallbackHtml && fallbackHtml.length > 0) {
        rawHtml = fallbackHtml;
      }
    }

    if (
      !rawHtml ||
      (!rawHtml.includes("imdb-user-review") &&
        !rawHtml.includes("lister-item") &&
        !rawHtml.includes("__NEXT_DATA__") &&
        !rawHtml.includes("application/ld+json"))
    ) {
      let mainTitleUrl = `https://www.imdb.com/title/${id}/`;
      let mainTitleHtml = await apiRequestRawHtml(mainTitleUrl);
      if (mainTitleHtml && mainTitleHtml.length > 0) {
        rawHtml = mainTitleHtml;
      }
    }

    if (rawHtml && rawHtml.includes("__NEXT_DATA__")) {
      const extracted = extractFromNextData(rawHtml, id, option.name, sortOrder);
      if (extracted && extracted.reviews.length > 0) {
        parsedReviews = extracted.reviews;
        nextApiPath = extracted.nextKey;
      }
    }

    if (parsedReviews.length === 0 && rawHtml && rawHtml.includes("application/ld+json")) {
      const ldReviews = extractFromLdJson(rawHtml);
      if (ldReviews && ldReviews.length > 0) {
        parsedReviews = ldReviews;
      }
    }

    // -------------------------------------------------------------
    // Strategy 2: HTML DOM element parsing (classic and modern selectors)
    // -------------------------------------------------------------
    if (parsedReviews.length === 0 && rawHtml) {
      let parser = new DomParser();
      let dom = parser.parseFromString(rawHtml);

      let items = dom.getElementsByClassName("imdb-user-review");
      if (!items || items.length === 0) {
        items = dom.getElementsByClassName("lister-item");
      }

      if (items && items.length > 0) {
        items.forEach((node) => {
          try {
            let review = {};

            try {
              review.id = node.getAttribute("data-review-id") || null;
            } catch (_) {
              review.id = null;
            }

            try {
              let author = node.getElementsByClassName("display-name-link")[0];
              review.author = author
                ? entityDecoder(author.textContent.trim(), { level: "html5" })
                : "Anonymous";

              let aTag = author ? author.getElementsByTagName("a")[0] : null;
              review.authorUrl = aTag
                ? "https://www.imdb.com" + aTag.getAttribute("href")
                : null;
            } catch (_) {
              if (!review.author) review.author = "Anonymous";
              if (!review.authorUrl) review.authorUrl = null;
            }

            try {
              let userMatch = review.authorUrl
                ? review.authorUrl.match(/\/user\/([^\/?]+)/)
                : null;
              review.user_api_path = userMatch ? "/user/" + userMatch[1] : null;
            } catch (error) {
              review.user_api_path = null;
            }

            try {
              let reviewDateNode = node.getElementsByClassName("review-date")[0];
              let reviewDate = reviewDateNode ? reviewDateNode.textContent.trim() : null;
              review.date = reviewDate ? new Date(reviewDate).toISOString() : null;
            } catch (error) {
              review.date = null;
            }

            try {
              let ratingsBar =
                node.getElementsByClassName("ipl-ratings-bar")[0] ||
                node.getElementsByClassName("rating-other-user-rating")[0];
              let stars = ratingsBar ? ratingsBar.textContent : "";
              let match = stars.match(/\d+/g);
              review.stars = match ? parseInt(match[0]) : 0;
            } catch (_) {
              review.stars = 0;
            }

            try {
              let heading = node.getElementsByClassName("title")[0];
              review.heading = heading
                ? entityDecoder(heading.textContent.trim(), { level: "html5" })
                : null;
            } catch (_) {
              review.heading = null;
            }

            try {
              let content =
                node.getElementsByClassName("text")[0] ||
                node.getElementsByClassName("content")[0];
              review.content = content
                ? entityDecoder(content.textContent.trim(), { level: "html5" })
                : null;
            } catch (_) {
              review.content = null;
            }

            try {
              let helpfulNessNode = node.getElementsByClassName("actions")[0];
              let helpfulNess = helpfulNessNode
                ? helpfulNessNode.textContent.trim()
                : "";

              let match = helpfulNess.match(/\d+/g);
              if (match && match.length >= 2) {
                review.helpfulNess = {
                  votes: parseInt(match[1]),
                  votedAsHelpful: parseInt(match[0]),
                  votedAsHelpfulPercentage:
                    Math.round((parseInt(match[0]) / parseInt(match[1])) * 100) || 0,
                };
              } else {
                review.helpfulNess = {
                  votes: 0,
                  votedAsHelpful: 0,
                  votedAsHelpfulPercentage: 0,
                };
              }
            } catch (_) {
              review.helpfulNess = {
                votes: 0,
                votedAsHelpful: 0,
                votedAsHelpfulPercentage: 0,
              };
            }

            review.reviewLink = review.id
              ? `https://www.imdb.com/review/${review.id}`
              : null;

            parsedReviews.push(review);
          } catch (__) {}
        });

        try {
          let morePage = dom.getElementsByClassName("load-more-data")[0];
          if (morePage) {
            let nextKeyVal = morePage.getAttribute("data-key");
            if (nextKeyVal) {
              nextApiPath = `/reviews/${id}?option=${option.name}&sortOrder=${sortOrder}&nextKey=${nextKeyVal}`;
            }
          }
        } catch (_) {}
      }
    }

    // -------------------------------------------------------------
    // Strategy 3: GraphQL Fallback Request
    // -------------------------------------------------------------
    if (parsedReviews.length === 0) {
      try {
        const gqlData = await apiRequestGraphQL(REVIEWS_QUERY, { id, first: 25 });
        const reviewEdges = gqlData?.title?.reviews?.edges || [];

        reviewEdges.forEach((edge) => {
          const n = edge?.node;
          if (!n) return;

          const userId = n.author?.userId || null;
          const upVotes = n.helpfulness?.upVotes || 0;
          const totalVotes = n.helpfulness?.totalVotes || 0;
          const percentage =
            totalVotes > 0 ? Math.round((upVotes / totalVotes) * 100) : 0;

          let dateISO = null;
          if (n.submissionDate) {
            try {
              dateISO = new Date(n.submissionDate).toISOString();
            } catch (_) {}
          }

          parsedReviews.push({
            id: n.id || null,
            author: n.author?.nickName || "Anonymous",
            authorUrl: userId ? `https://www.imdb.com/user/${userId}` : null,
            user_api_path: userId ? `/user/${userId}` : null,
            date: dateISO,
            stars: n.authorRating || 0,
            heading: n.summary?.originalText || null,
            content: n.text?.originalText?.plainText || null,
            helpfulNess: {
              votes: totalVotes,
              votedAsHelpful: upVotes,
              votedAsHelpfulPercentage: percentage,
            },
            reviewLink: n.id ? `https://www.imdb.com/review/${n.id}` : null,
          });
        });

        if (gqlData?.title?.reviews?.pageInfo?.endCursor) {
          nextApiPath = `/reviews/${id}?option=${option.name}&sortOrder=${sortOrder}&nextKey=${gqlData.title.reviews.pageInfo.endCursor}`;
        }
      } catch (_) {}
    }

    let result = {
      id,
      imdb: `https://www.imdb.com/title/${id}`,
      option: option.name,
      sortOrder,
      availableOptions: optionsMapper.map((option) => option.name),
      availableSortOrders: ["asc", "desc"],
      reviews: parsedReviews,
      next_api_path: nextApiPath,
    };

    return c.json(result);
  } catch (error) {
    c.status(500);
    return c.json({
      message: error.message,
    });
  }
});

function extractFromLdJson(html) {
  const matches = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/gs);
  if (!matches) return null;

  const reviews = [];
  for (const match of matches) {
    try {
      const jsonText = match
        .replace(/^<script[^>]*>/, "")
        .replace(/<\/script>$/, "");
      const json = JSON.parse(jsonText);

      let rawReviews = [];
      if (json.review) {
        rawReviews = Array.isArray(json.review) ? json.review : [json.review];
      } else if (json["@type"] === "Review") {
        rawReviews = [json];
      }

      rawReviews.forEach((r, idx) => {
        if (!r || (!r.name && !r.reviewBody)) return;
        const authorName = typeof r.author === "string" ? r.author : (r.author?.name || "Anonymous");
        const stars = r.reviewRating?.ratingValue ? parseInt(r.reviewRating.ratingValue) : 0;
        let dateISO = null;
        if (r.dateCreated) {
          try {
            dateISO = new Date(r.dateCreated).toISOString();
          } catch (_) {}
        }

        reviews.push({
          id: `review-${idx + 1}`,
          author: entityDecoder(String(authorName), { level: "html5" }),
          authorUrl: null,
          user_api_path: null,
          date: dateISO,
          stars,
          heading: r.name ? entityDecoder(String(r.name), { level: "html5" }) : null,
          content: r.reviewBody ? entityDecoder(String(r.reviewBody), { level: "html5" }) : null,
          helpfulNess: {
            votes: 0,
            votedAsHelpful: 0,
            votedAsHelpfulPercentage: 0,
          },
          reviewLink: null,
        });
      });
    } catch (_) {}
  }

  return reviews.length > 0 ? reviews : null;
}

function extractFromNextData(html, id, optionName, sortOrder) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (!match) return null;

  try {
    const json = JSON.parse(match[1]);
    const reviews = [];
    let nextKey = null;

    const processEdge = (edge) => {
      const node = edge?.node || edge;
      if (!node || (!node.id && !node.summary && !node.text && !node.heading && !node.author)) return;

      const reviewId = node.id || null;
      if (reviewId && reviews.some((r) => r.id === reviewId)) return;

      const authorName =
        node.author?.nickName || node.author?.username || node.author?.displayName || "Anonymous";
      const userId = node.author?.userId || null;
      const heading =
        node.summary?.originalText || node.heading?.originalText || node.heading || null;
      const content =
        node.text?.originalText?.plainText ||
        node.content?.plainText ||
        node.content ||
        null;
      const stars = node.authorRating || node.rating || 0;
      const dateStr = node.submissionDate || node.date || null;
      let dateISO = null;
      if (dateStr) {
        try {
          dateISO = new Date(dateStr).toISOString();
        } catch (_) {}
      }

      const upVotes = node.helpfulness?.upVotes || node.helpfulness?.votedAsHelpful || 0;
      const totalVotes = node.helpfulness?.totalVotes || node.helpfulness?.votes || 0;
      const percentage =
        totalVotes > 0 ? Math.round((upVotes / totalVotes) * 100) : 0;

      reviews.push({
        id: reviewId,
        author: entityDecoder(String(authorName), { level: "html5" }),
        authorUrl: userId ? `https://www.imdb.com/user/${userId}` : null,
        user_api_path: userId ? `/user/${userId}` : null,
        date: dateISO,
        stars,
        heading: heading ? entityDecoder(String(heading), { level: "html5" }) : null,
        content: content ? entityDecoder(String(content), { level: "html5" }) : null,
        helpfulNess: {
          votes: totalVotes,
          votedAsHelpful: upVotes,
          votedAsHelpfulPercentage: percentage,
        },
        reviewLink: reviewId ? `https://www.imdb.com/review/${reviewId}` : null,
      });
    };

    // Recursive search across Next.js pageProps
    function walk(obj, depth = 0) {
      if (!obj || depth > 10) return;
      if (Array.isArray(obj)) {
        obj.forEach((item) => walk(item, depth + 1));
      } else if (typeof obj === "object") {
        if (obj.edges && Array.isArray(obj.edges)) {
          obj.edges.forEach(processEdge);
        }
        if (obj.node && (obj.node.summary || obj.node.text || obj.node.authorRating)) {
          processEdge(obj.node);
        }
        for (const k of Object.keys(obj)) {
          if (
            k === "reviews" ||
            k === "featuredReviews" ||
            k === "urqlState" ||
            k === "contentData" ||
            k === "mainColumnData" ||
            k === "aboveTheFoldData" ||
            k === "edges"
          ) {
            walk(obj[k], depth + 1);
          } else if (typeof obj[k] === "object") {
            walk(obj[k], depth + 1);
          }
        }
      }
    }

    if (json.props?.pageProps) {
      walk(json.props.pageProps);
    }

    if (reviews.length > 0) {
      return { reviews, nextKey };
    }
  } catch (_) {}

  return null;
}

export default reviews;

const optionsMapper = [
  {
    key: "totalVotes",
    name: "helpfulness",
  },
  {
    key: "submissionDate",
    name: "date",
  },
  {
    key: "totalVotes",
    name: "votes",
  },
  {
    key: "userRating",
    name: "rating",
  },
];
