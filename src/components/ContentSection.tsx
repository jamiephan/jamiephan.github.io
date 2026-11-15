import type { Project, Section } from "../content.tsx";

interface ContentSectionProps {
  section: Section;
  align: "start" | "end";
}

export function ContentSection({ section, align }: ContentSectionProps) {
  const titleId = `${section.id}-title`;

  return (
    <section id={section.id} className="section" data-align={align} aria-labelledby={titleId}>
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
        <dl className="skills">
          {section.skills.map(({ category, items }) => (
            <div key={category}>
              <dt>{category}</dt>
              <dd>{items}</dd>
            </div>
          ))}
        </dl>
      );

    case "projects":
      return (
        <>
          {section.intro}
          <ul className="projects">
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
    <li className="project">
      <h3>
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
      <p>{project.description}</p>
    </li>
  );
}
