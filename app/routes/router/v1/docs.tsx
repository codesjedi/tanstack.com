import * as React from 'react'
import { FaDiscord, FaGithub } from 'react-icons/fa'
import { Link } from '@remix-run/react'
import type { MetaFunction } from '@remix-run/node'
import { useRouterV1Config } from '../v1'
import { gradientText } from './index'
import { seo } from '~/utils/seo'
import type { DocsConfig } from '~/components/Docs'
import { Docs } from '~/components/Docs'

const logo = (
  <>
    <Link to="/" className="font-light">
      TanStack
    </Link>
    <Link to=".." className={`font-bold`}>
      <span className={`${gradientText}`}>Router</span>{' '}
      <span className="text-sm align-super">BETA</span>
    </Link>
  </>
)

const localMenu = {
  label: 'Menu',
  children: [
    {
      label: 'Home',
      to: '..',
    },
    {
      label: (
        <div className="flex items-center gap-2">
          GitHub <FaGithub className="text-lg opacity-20" />
        </div>
      ),
      to: 'https://github.com/tanstack/router',
    },
    {
      label: (
        <div className="flex items-center gap-2">
          Discord <FaDiscord className="text-lg opacity-20" />
        </div>
      ),
      to: 'https://tlinz.com/discord',
    },
  ],
}

export let meta: MetaFunction = () => {
  return seo({
    title:
      'TanStack Router Docs | React Router, Solid Router, Svelte Router, Vue Router',
    description: 'Modern and scalable routing for applications',
  })
}

export default function DocsRoute() {
  let config = useRouterV1Config()

  config = React.useMemo(
    () =>
      ({
        ...config,
        menu: [localMenu, ...config.menu],
      } as DocsConfig),
    [config]
  )

  return (
    <Docs
      {...{
        logo,
        colorFrom: 'from-lime-500',
        colorTo: 'to-emerald-500',
        textColor: 'text-emerald-500',
        config,
      }}
    />
  )
}