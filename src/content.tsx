import type { ReactNode } from "react";

export interface Project {
  name: string;
  url: string;
  /** Optional separate link to the source code when `url` points to a live site. */
  sourceUrl?: string;
  description: ReactNode;
}

interface SectionBase {
  id: string;
  emoji: string;
  title: string;
}

export interface ProseSection extends SectionBase {
  kind: "prose";
  body: ReactNode;
}

export interface SkillsSection extends SectionBase {
  kind: "skills";
  skills: { category: string; items: string }[];
}

export interface ProjectsSection extends SectionBase {
  kind: "projects";
  intro?: ReactNode;
  projects: Project[];
}

export type Section = ProseSection | SkillsSection | ProjectsSection;

export const site = {
  name: "Jamie Phan",
  emoji: "🚀",
  tagline: "Software Engineer",
  links: {
    blog: "https://blog.jamiephan.net",
    email: "mailto:me@jamiephan.net",
    github: "https://github.com/jamiephan",
    linkedin: "https://www.linkedin.com/in/phanjamie/",
  },
} as const;

const gh = (repo: string) => `https://github.com/jamiephan/${repo}`;

export const sections: Section[] = [
  {
    id: "about",
    kind: "prose",
    emoji: "👨‍🦱",
    title: "About Me",
    body: (
      <>
        <p>
          I’m Jamie Phan (he/him), a software engineer with a degree in Computer Science from the
          University of Leicester. I work across the stack, from TypeScript and React front ends to
          Node.js services, containerised infrastructure and CI/CD pipelines, and I’m comfortable
          dropping down to native code when a problem calls for it.
        </p>
        <p>
          What I enjoy most is automation and developer tooling: spotting repetitive, error-prone
          work and turning it into systems that run reliably without anyone having to think about
          them. That might be a GitHub Actions pipeline that tracks every game update, a serverless
          API on Cloudflare Workers, or a Node-API binding published to npm so other developers
          don’t have to write one themselves.
        </p>
        <p>
          I care about the details that make software pleasant to use and easy to maintain: clear
          interfaces, accessible and fast web pages, sensible defaults, and documentation that
          answers the next question before it’s asked. I’m equally at home in Linux and Windows
          environments, and in the networking and identity layers that sit underneath most
          production systems.
        </p>
        <p>
          Outside of work, I build and maintain open-source tools for the Heroes of the Storm
          modding community, from a browser-based map generator to automated data archives that
          other modders rely on. It’s where I experiment with new tools and techniques, which often
          find their way back into my day-to-day work.
        </p>
        <p>
          I write occasionally on my <a href={site.links.blog}>blog</a>. You can connect with me on{" "}
          <a href={site.links.linkedin}>LinkedIn</a>, reach me by{" "}
          <a href={site.links.email}>email</a> or browse my open-source work on{" "}
          <a href={site.links.github}>GitHub</a>.
        </p>
      </>
    ),
  },
  {
    id: "skills",
    kind: "skills",
    emoji: "📜",
    title: "Skills",
    skills: [
      {
        category: "Languages",
        items: "TypeScript, JavaScript, Java, Python, C#, C++, SQL, Bash, PowerShell",
      },
      {
        category: "Java & Spring",
        items:
          "Spring Boot, Spring MVC, Spring Data JPA, Spring Security, Hibernate, Maven, Gradle, JUnit",
      },
      {
        category: "Node.js & TypeScript",
        items:
          "Node.js, Express, Hono, Next.js, Node-API (N-API) native addons, npm package publishing",
      },
      {
        category: "Front end",
        items:
          "React, Vite, Three.js, HTML, CSS, responsive design, accessibility (WCAG), web performance",
      },
      {
        category: "Desktop",
        items: "Electron, cross-platform installers and auto-updating release pipelines",
      },
      {
        category: "APIs & architecture",
        items:
          "RESTful API design, microservices, serverless functions, JSON / XML / YAML data processing",
      },
      {
        category: "Databases & caching",
        items: "MySQL, PostgreSQL, SQLite, MongoDB, Redis",
      },
      {
        category: "DevOps & cloud",
        items:
          "Docker, Kubernetes, Cloudflare Workers, GitHub Actions, CI/CD pipelines, infrastructure automation",
      },
      {
        category: "Testing & quality",
        items: "Unit and integration testing (JUnit, Vitest), linting, type checking, code review",
      },
      {
        category: "Platforms",
        items:
          "Linux and Windows administration, shell scripting (Bash, PowerShell, batch), virtualisation",
      },
      {
        category: "Networking & identity",
        items:
          "Firewalls, gateways, reverse proxies, DNS, Kerberos, Active Directory, Microsoft Entra ID",
      },
      {
        category: "Tools & practices",
        items: "Git, GitHub, Agile delivery, technical documentation, automation-first workflows",
      },
    ],
  },
  {
    id: "projects",
    kind: "projects",
    emoji: "📜",
    title: "Projects",
    intro: (
      <p>
        Much of my professional work lives in private repositories, so this is a selection of my
        open-source projects. You’ll find more on <a href={site.links.github}>GitHub</a>.
      </p>
    ),
    projects: [
      {
        name: "jamiephan.github.io",
        url: gh("jamiephan.github.io"),
        description:
          "This website: a prerendered React and TypeScript site built with Vite, set against an interactive Three.js solar system rendered in real time.",
      },
      {
        name: "simple-multicast-share",
        url: gh("simple-multicast-share"),
        description:
          "A self-contained file and text sharing app for local networks, distributed as a single binary backed by SQLite, with multicast DNS discovery so devices find it automatically.",
      },
      {
        name: "cf-bnet-version",
        url: gh("cf-bnet-version"),
        description: (
          <>
            A Cloudflare Workers API built with Hono that fetches the latest application versions
            from Battle.net and serves them as JSON, including{" "}
            <a href="https://shields.io/">Shields.io</a> badge endpoints.
          </>
        ),
      },
    ],
  },
  {
    id: "hots-modding",
    kind: "projects",
    emoji: "❄️",
    title: "Heroes of the Storm: Modding",
    intro: (
      <>
        <p>
          <a href="https://heroesofthestorm.blizzard.com/">Heroes of the Storm</a>, Blizzard’s MOBA,
          runs on a modified StarCraft II engine. Unlike StarCraft II, it ships without a public map
          editor, but it inherits undocumented support for loading custom maps.
        </p>
        <p>
          With more than 3,000 hours in the game and many more spent modding it, I build open-source
          tools that make custom maps accessible to the community.
        </p>
      </>
    ),
    projects: [
      {
        name: "CascLib & StormLib for Node.js",
        url: gh("casclib-stormlib-monorepo"),
        description: (
          <>
            Modern cross-platform Node-API (N-API) native bindings for CascLib and StormLib, the
            libraries for reading Blizzard game archives. Published on npm as{" "}
            <a href="https://www.npmjs.com/package/@jamiephan/casclib">
              <code>@jamiephan/casclib</code>
            </a>{" "}
            and{" "}
            <a href="https://www.npmjs.com/package/@jamiephan/stormlib">
              <code>@jamiephan/stormlib</code>
            </a>
            .
          </>
        ),
      },
      {
        name: "Storm Map Generator",
        url: "https://stormmap.jamiephan.net",
        sourceUrl: gh("HeroesOfTheStorm_StormMapGenerator"),
        description: (
          <>
            A web app that generates <code>.stormmap</code> files without any local tooling. Choose
            a template map, add AI players, enable debug mode, set a welcome message and attach
            custom XML game data, which you can edit and validate in the browser.
          </>
        ),
      },
      {
        name: "Try Mode 2.0",
        url: gh("HeroesOfTheStorm_TryMode2.0"),
        description:
          "A drop-in replacement for the in-game Try Mode that adds debug mode, unit spawning and live editing of game values, and builds map variants (including AI variants) from custom modding data.",
      },
      {
        name: "Try Mode 2.0 Installer",
        url: gh("HeroesOfTheStorm_TryMode2.0Installer"),
        description: (
          <>
            An Electron desktop app that simplifies installing <em>Try Mode 2.0</em> and fetches the
            latest maps from GitHub Releases.
          </>
        ),
      },
      {
        name: "AI Maps",
        url: gh("HeroesOfTheStorm_AIMaps"),
        description:
          "Automatically injects AI players into maps from the S2MA repository, generating team compositions such as 1v5 and 3v3. The 5v5 variant is used by Try Mode 2.0.",
      },
      {
        name: "Tools",
        url: gh("HeroesOfTheStorm_Tools"),
        description: "Utilities and scripts that support my Heroes of the Storm modding workflow.",
      },
    ],
  },
  {
    id: "hots-data",
    kind: "projects",
    emoji: "🛠️",
    title: "Heroes of the Storm: Data & Automation",
    projects: [
      {
        name: "Game Data",
        url: gh("HeroesOfTheStorm_Gamedata"),
        description: (
          <>
            An automatically updated archive of all non-binary game data. It also generates an{" "}
            <abbr title="XML Schema Definition">XSD</abbr> schema that enables validation and editor
            auto-completion for custom mods.
          </>
        ),
      },
      {
        name: "Game Data HTTP",
        url: gh("HeroesOfTheStorm_Gamedata_HTTP"),
        description:
          "A Cloudflare Workers API that serves the Game Data repository in multiple formats, with badge endpoint support.",
      },
      {
        name: "S2MA",
        url: gh("HeroesOfTheStorm_S2MA"),
        description:
          "A GitHub Actions pipeline that downloads each game update and extracts the map and mod files used by Try Mode 2.0 and AI Maps.",
      },
    ],
  },
  {
    id: "archived",
    kind: "projects",
    emoji: "🎮",
    title: "Archived Projects",
    projects: [
      {
        name: "storm-extract-docker",
        url: gh("storm-extract-docker"),
        description: (
          <>
            A containerised build of the{" "}
            <a href="https://github.com/nydus/storm-extract">storm-extract</a> command-line tool.
            Built from <code>scratch</code>, the image is just <code>1.52 MB</code>.
          </>
        ),
      },
      {
        name: "Battle.Net-Installer",
        url: gh("Battle.Net-Installer"),
        description: (
          <>
            A fork of{" "}
            <a href="https://github.com/barncastle/Battle.Net-Installer">
              <code>barncastle/Battle.Net-Installer</code>
            </a>{" "}
            adapted for non-interactive environments such as GitHub Actions. It powered the S2MA and
            Game Data pipelines.
          </>
        ),
      },
      {
        name: "Blizzcle",
        url: gh("blizzcle"),
        description:
          "A Node.js library and CLI for downloading Blizzard news articles as JSON or HTML.",
      },
      {
        name: "Snapshot Differ",
        url: gh("HeroesOfTheStorm_SnapshotDiffer"),
        description:
          "A pipeline that extracted game data on each patch, generated diffs against previous versions and posted them via a Reddit bot. Superseded by Game Data.",
      },
      {
        name: "Snapshot Differ Result",
        url: gh("HeroesOfTheStorm_SnapshotDifferResult"),
        description: "An archive of the patch diffs produced by Snapshot Differ.",
      },
      {
        name: "New Heroes Notification",
        url: gh("HeroesOfTheStorm_NewHeroesNotification"),
        description: "A PHP console application that monitored for and announced new heroes.",
      },
    ],
  },
];
