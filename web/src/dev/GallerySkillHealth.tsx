/** The dev gallery's « Santé des compétences » (section=skillhealth): a skill row of a bot's Skills tab, then the
 *  owner's view in Settings → Skills. Development only. */
import { CuratorCard, SkillHealthLine, SkillHealthPanel, SkillsHealthSection, TeamCatalogSection } from "../components/SkillHealth";
import { healthSkillFixture, skillHealthFixture } from "./skillHealthFixtures";
import type { FixtureOptions } from "./fixtures";

export function GallerySkillHealth({ s }: { s: FixtureOptions & { empty: boolean } }) {
  const report = skillHealthFixture(s, s.empty);
  const skill = healthSkillFixture(s);
  const h = report.skills[0];
  return (
    <div className="settings-pane">
      {!s.empty && h && <>
        <CuratorCard suggestions={report.suggestions.slice(0, 1)} onChanged={() => {}} />
        <ul className="list">
          <li className="list-row is-card skill-row">
            <div className="list-row-text">
              <span className="list-row-title">{h.name}<span className="pill is-shared">{s.lang === "fr" ? "Partagée" : "Shared"}</span></span>
              <span className="list-row-sub">{skill.description}</span>
              <SkillHealthLine h={h} onChanged={() => {}} />
            </div>
            <SkillHealthPanel h={h} skill={skill} onChanged={() => {}} defaultOpen />
          </li>
          <li className="list-row is-card skill-row">
            <div className="list-row-text">
              <span className="list-row-title">{report.skills[1].name}</span>
              <SkillHealthLine h={report.skills[1]} onChanged={() => {}} />
            </div>
          </li>
        </ul>
      </>}
      <div className="skl-library">
        <TeamCatalogSection />
        <SkillsHealthSection />
      </div>
    </div>
  );
}
