import type { Project, Section } from "../content.tsx";

interface ContentSectionProps {
  section: Section;
  align: "start" | "end";
}

export function ContentSection({ section, align }: ContentSectionProps) {
  const titleId = `${section.id}-title`;

  return (
    <section
      id={section.id}
      className="section"
      data-align={align}
      aria-labelledby={titleId}
      // Focusable from script only, so "Scroll to explore" can move focus here.
      tabIndex={-1}
    >
      <div className="panel">
        <h2 id={titleId}>
          <span aria-hidden="true">{section.emoji}</span> {section.title}
        </h2>
        <SectionBody section={section} />
      </div>
    </section>
  );
}

function SectionBody({ section }: { section: Section }) {
  switch (section.kind) {
    case "prose":
      return section.body;

    case "skills":
      return (
        <dl className="entries">
          {section.skills.map(({ category, items }) => (
            <div key={category} className="entry">
              <dt className="entry__title">{category}</dt>
              <dd className="entry__body">{items}</dd>
            </div>
          ))}
        </dl>
      );

    case "projects":
      return (
        <>
          {section.intro}
          <ul className="entries">
            {section.projects.map((project) => (
              <ProjectItem key={project.name} project={project} />
            ))}
          </ul>
        </>
      );
  }
}

function ProjectItem({ project }: { project: Project }) {
  return (
    <li className="entry">
      <h3 className="entry__title">
        <a href={project.url}>{project.name}</a>
        {project.sourceUrl && (
          <>
            {" "}
            <a className="project__source" href={project.sourceUrl}>
              (source code<span className="visually-hidden"> for {project.name}</span>)
            </a>
          </>
        )}
      </h3>
      <p className="entry__body">{project.description}</p>
    </li>
  );
}
