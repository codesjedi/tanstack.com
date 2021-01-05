import { graphql } from '@octokit/graphql'
// import crypto from 'crypto'
import { middleware } from '../../server/middleware'
import { getSponsorsTable, getTiersTable } from '../../utils/airtable'

const graphqlWithAuth = graphql.defaults({
  headers: {
    authorization: `token ${process.env.GITHUB_AUTH_TOKEN}`,
  },
})

// async function verifySecret(req) {
//   const sig = req.headers['x-hub-signature'] || ''
//   const hmac = crypto.createHmac(
//     'sha1',
//     process.env.GITHUB_SPONSORS_WEBHOOK_SECRET
//   )
//   const digest = Buffer.from(
//     'sha1=' + hmac.update(JSON.stringify(req.body)).digest('hex'),
//     'utf8'
//   )
//   const checksum = Buffer.from(sig, 'utf8')
//   if (
//     checksum.length !== digest.length ||
//     !crypto.timingSafeEqual(digest, checksum)
//   ) {
//     throw new Error(
//       `Request body digest (${digest}) did not match x-hub-signature (${checksum})`
//     )
//   }
// }

export default async function handler(req, res) {
  await middleware(req, res)
  // await verifySecret(req, res)

  // const { body } = req

  // switch (body.action) {
  //   case 'created':
  //     {
  //       const {
  //         sponsorship: {
  //           created_at,
  //           sponsor: { login: username },
  //           tier: {
  //             node_id: tier_id,
  //             name: tier_name
  //           }
  //         },
  //       } = body

  //       "tier": {
  //         "node_id": "MDEyOlNwb25zb3JzVGllcjE=",
  //         "created_at": "2019-12-20T19:17:05Z",
  //         "description": "foo",
  //         "monthly_price_in_cents": 500,
  //         "monthly_price_in_dollars": 5,
  //         "name": "$5 a month"
  //       }
  //     }
  //     break
  //   case 'cancelled':
  //     break
  //   case 'edited':
  //     break
  //   case 'tier_changed':
  //     break
  //   case 'pending_cancellation':
  //     break
  //   case 'pending_tier_change':
  //     break
  // }

  let { sponsors, tiers } = await getSponsorsAndTiers()

  sponsors = sponsors.filter((d) => d.privacyLevel === 'PUBLIC')

  res.status(200)
  res.json({ sponsors, tiers })
}

async function getSponsorsAndTiers() {
  const tiers = await getGithubTiers()
  await updateAirtableTierReferences(tiers)

  const [sponsors, sponsorsMeta] = await Promise.all([
    getGithubSponsors(),
    getSponsorsMeta().then((all) => all.map((d) => d.fields)),
  ])

  sponsorsMeta.forEach((meta) => {
    const matchingSponsor = sponsors.find((d) => d.login == meta.login)

    if (matchingSponsor) {
      Object.assign(matchingSponsor, {
        logoURL: meta.logoURL,
        linkURL: meta.linkURL,
      })
    } else {
      sponsors.push(meta)
    }
  })

  sponsors.sort(
    (a, b) =>
      b.monthlyPriceInCents - a.monthlyPriceInCents ||
      (b.createdAt > a.createdAt ? -1 : 1)
  )

  return {
    sponsors,
    tiers,
  }
}

async function getGithubSponsors() {
  let sponsors = []

  const fetchPage = async (cursor = '') => {
    const res = await graphqlWithAuth(
      `
      query ($cursor: String) {
        viewer {
          sponsorshipsAsMaintainer(first: 100, after: $cursor, includePrivate: true) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                createdAt
                sponsor {
                  name
                  login
                }
                tier {
                  id
                  monthlyPriceInCents
                }
                privacyLevel
              }
            }
          }
        }
      }
      `,
      {
        cursor,
      }
    )

    const {
      viewer: {
        sponsorshipsAsMaintainer: {
          pageInfo: { hasNextPage, endCursor },
          edges,
        },
      },
    } = res

    sponsors = [
      ...sponsors,
      ...edges.map((edge) => {
        const {
          node: {
            createdAt,
            sponsor,
            tier: { id: tierId, monthlyPriceInCents },
            privacyLevel,
          },
        } = edge

        if (!sponsor) {
          return null
        }

        const { name, login } = sponsor

        return {
          name,
          login,
          tierId,
          createdAt,
          monthlyPriceInCents,
          privacyLevel,
        }
      }),
    ]

    if (hasNextPage) {
      await fetchPage(endCursor)
    }
  }

  await fetchPage()

  return sponsors.filter(Boolean)
}

async function getGithubTiers() {
  const res = await graphqlWithAuth(
    `query {
      viewer {
        sponsorshipsAsMaintainer(first: 1) {
          nodes {
            sponsorable {
              sponsorsListing {
                tiers(first: 100) {
                  nodes {
                    id
                    name
                    description
                    descriptionHTML
                    monthlyPriceInCents
                  }
                }
              }
            }
          }
        }
      }
    }`
  )

  return res.viewer.sponsorshipsAsMaintainer.nodes[0].sponsorable
    .sponsorsListing.tiers.nodes
}

async function getSponsorsMeta() {
  const sponsorsTable = await getSponsorsTable()

  return new Promise((resolve, reject) => {
    let allSponsors = []
    sponsorsTable.select().eachPage(
      function page(records, fetchNextPage) {
        allSponsors = [...allSponsors, ...records]
        fetchNextPage()
      },
      function done(err) {
        if (err) {
          reject(err)
        } else {
          resolve(allSponsors)
        }
      }
    )
  })
}

async function updateAirtableTierReferences(newTiers) {
  const tiersTable = await getTiersTable()

  const tiers = await new Promise((resolve, reject) => {
    let allTiers = []
    tiersTable.select().eachPage(
      function page(records, fetchNextPage) {
        allTiers = [...allTiers, ...records]
        fetchNextPage()
      },
      function done(err) {
        if (err) {
          reject(err)
        } else {
          resolve(allTiers)
        }
      }
    )
  })

  await Promise.all(
    tiers.map((tier) => {
      const newTier = newTiers.find((d) => d.id === tier.fields.id)
      if (newTier) {
        newTiers = newTiers.filter((d) => d !== newTier)
        return tier.updateFields({
          name: newTier.name,
        })
      }
      return tier.destroy()
    })
  )

  if (newTiers?.length) {
    await new Promise((resolve, reject) =>
      tiersTable.create(
        newTiers.map((d) => ({ fields: { id: d.id, name: d.name } })),
        function (err) {
          if (err) {
            return reject(err)
          }
          resolve()
        }
      )
    )
  }
}