import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { OfficeModal as Modal } from "./office-modal.js";
import type { SkillInfo, SkillsResult } from "../shared/contracts.js";
import { ActionButton, failureText } from "./action-button.js";
import { textAfterSend } from "./agent-card.js";
import { Chip } from "./board-sheet.js";
import {
  LIBRARY_HELP,
  librarySummary,
  HOST_SKILLS_SHOWN,
  SEARCH_FROM,
  busyLine,
  skillMatches,
  skillTeams,
  skillWhere,
  unreadLine,
  workspaceSkills,
  TOPIC_MAX,
  askHint,
  type LibraryAsked,
  type LibraryTeam,
} from "./library-text.js";
import type { OfficeStyles } from "./styles.js";

interface SkillRowProps {
  skill: SkillInfo;
  /** Where it is, after its folders: the workspaces that have it. */
  where?: string;
  styles: OfficeStyles;
}

/** A description is two lines until the row is pressed. */
function SkillRow({ skill, where, styles }: SkillRowProps) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((current) => !current), []);
  const place = where ? `${skillWhere(skill)} · ${where}` : skillWhere(skill);
  if (skill.description === null) {
    return (
      <View style={styles.skillRow}>
        <Text style={styles.skillName}>{skill.name}</Text>
        <Text style={styles.rowMeta}>{place}</Text>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${skill.name}: ${open ? "show less" : "show all of what it is for"}`}
      aria-expanded={open}
      onPress={toggle}
      style={styles.skillRow}
    >
      <Text style={styles.skillName}>{skill.name}</Text>
      <Text style={styles.rowMeta} numberOfLines={open ? undefined : 2}>
        {skill.description}
      </Text>
      <Text style={styles.rowMeta}>{place}</Text>
    </Pressable>
  );
}

interface AskedProps {
  team: LibraryTeam;
  asked: LibraryAsked;
  onOpenBoard(roomId: string): void;
  styles: OfficeStyles;
}

/** A team's newest request for a skill and what came of it. */
function Asked({ team, asked, onOpenBoard, styles }: AskedProps) {
  const openBoard = useCallback(() => onOpenBoard(team.roomId), [onOpenBoard, team.roomId]);
  return (
    <View style={styles.libraryPanel}>
      <Text style={styles.sheetLabel}>{team.name}</Text>
      {asked.text === null ? (
        <Text style={styles.rowMeta}>
          Asked {asked.title} for “{asked.topic}”. Its note shows here once it is on the board.
        </Text>
      ) : (
        <>
          <Text style={styles.rowMeta}>
            {asked.title} on “{asked.topic}”
          </Text>
          <Text style={styles.sheetText}>{asked.text}</Text>
          {asked.cut ? <Text style={styles.rowMeta}>The board has the rest.</Text> : null}
        </>
      )}
      <View style={styles.actions}>
        <ActionButton
          label="Open board"
          pendingLabel="Opening..."
          onPress={openBoard}
          styles={styles}
        />
      </View>
    </View>
  );
}

interface TeachProps {
  team: LibraryTeam;
  wakesPaused: boolean;
  teach(team: LibraryTeam, agentId: string, topic: string): Promise<void>;
  styles: OfficeStyles;
}

/** What the skill should teach, who writes it, and the button that asks. */
function Teach({ team, wakesPaused, teach, styles }: TeachProps) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [topic, setTopic] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // The agent picked may have gone to work since: then the newest idle one writes it.
  const chosen =
    team.writers.find((writer) => writer.agentId === picked) ?? team.writers[0] ?? null;
  const label = chosen === null ? "Ask" : `Ask ${chosen.title} to write it`;
  const ask = useCallback(async () => {
    if (chosen === null) return;
    const sent = topic.trim();
    setFailure(null);
    try {
      await teach(team, chosen.agentId, sent);
      if (mounted.current) setTopic((current) => textAfterSend(current, sent));
    } catch (caught) {
      if (mounted.current) setFailure(failureText(label, caught));
    }
  }, [chosen, topic, teach, team, label]);
  const hint = askHint(team, chosen?.title ?? null, wakesPaused);
  if (chosen === null) return <Text style={styles.muted}>{hint}</Text>;
  return (
    <View style={styles.sheetField}>
      <Text style={styles.rowMeta}>What it should teach</Text>
      <TextInput
        accessibilityLabel={`What a skill of ${team.name} should teach`}
        value={topic}
        onChangeText={setTopic}
        placeholder="How this project cuts a release"
        placeholderTextColor={styles.placeholderColor}
        maxLength={TOPIC_MAX}
        // (multiline so a long topic and the placeholder wrap; a line break becomes a space)
        multiline
        style={styles.input}
      />
      {team.writers.length > 1 ? (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Who writes it"
          style={styles.sheetField}
        >
          <Text style={styles.rowMeta}>Who writes it</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chipRow}
          >
            {team.writers.map((writer) => (
              <Chip
                key={writer.agentId}
                label={writer.title}
                value={writer.agentId}
                selected={writer.agentId === chosen.agentId}
                onSelect={setPicked}
                styles={styles}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}
      <View style={styles.actions}>
        <ActionButton
          label={label}
          pendingLabel="Asking..."
          onPress={ask}
          disabled={wakesPaused || topic.trim().length === 0}
          styles={styles}
        />
      </View>
      {failure ? (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {failure}
        </Text>
      ) : null}
      <Text style={styles.rowMeta}>{hint}</Text>
    </View>
  );
}

interface TeachTabProps {
  teams: readonly LibraryTeam[];
  wakesPaused: boolean;
  teach(team: LibraryTeam, agentId: string, topic: string): Promise<void>;
  onOpenBoard(roomId: string): void;
  styles: OfficeStyles;
}

/** One form for the team picked, the teams nobody of can be asked in one line, and the answers. */
function TeachTab({ teams, wakesPaused, teach, onOpenBoard, styles }: TeachTabProps) {
  const askable = teams.filter((team) => team.writers.length > 0);
  const [picked, setPicked] = useState<string | null>(null);
  // The team picked may have gone to work since: then the first with an idle agent is asked.
  const team = askable.find((candidate) => candidate.roomId === picked) ?? askable[0] ?? null;
  const busy = busyLine(teams);
  const asked = teams.filter((candidate) => candidate.asked !== null);
  return (
    <View style={styles.sheet}>
      <Text style={styles.rowMeta}>{LIBRARY_HELP}</Text>
      {team === null ? null : (
        <View style={styles.libraryPanel}>
          {askable.length > 1 ? (
            <View style={styles.sheetField}>
              <Text style={styles.rowMeta}>Team</Text>
              <View accessibilityRole="radiogroup" accessibilityLabel="Team" style={styles.chips}>
                {askable.map((candidate) => (
                  <Chip
                    key={candidate.roomId}
                    label={candidate.name}
                    value={candidate.roomId}
                    selected={candidate.roomId === team.roomId}
                    onSelect={setPicked}
                    styles={styles}
                  />
                ))}
              </View>
            </View>
          ) : (
            <Text style={styles.sheetLabel}>{team.name}</Text>
          )}
          {/* (keyed by team: a topic typed for one team is not sent to another) */}
          <Teach
            key={team.roomId}
            team={team}
            wakesPaused={wakesPaused}
            teach={teach}
            styles={styles}
          />
        </View>
      )}
      {busy === null ? null : <Text style={styles.muted}>{busy}</Text>}
      {asked.length === 0 ? null : (
        <View style={styles.qaGroup}>
          <Text accessibilityRole="header" style={styles.standupHeading}>
            Requests
          </Text>
          {asked.map((candidate) =>
            candidate.asked === null ? null : (
              <Asked
                key={candidate.roomId}
                team={candidate}
                asked={candidate.asked}
                onOpenBoard={onOpenBoard}
                styles={styles}
              />
            ),
          )}
        </View>
      )}
    </View>
  );
}

interface HostSkillsProps {
  skills: readonly SkillInfo[];
  /** What is searched for; empty when nothing is. */
  query: string;
  /** The office has teams, which come first: many of the host's fold behind a button. */
  afterTeams: boolean;
  styles: OfficeStyles;
}

function HostSkills({ skills, query, afterTeams, styles }: HostSkillsProps) {
  const shown = useMemo(
    () => (query === "" ? skills : skills.filter((skill) => skillMatches(skill, query))),
    [skills, query],
  );
  // A search opens the fold: what it found must show.
  const folded = afterTeams && query === "" && skills.length > HOST_SKILLS_SHOWN;
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((current) => !current), []);
  const label = open ? "Hide the host's skills" : `Show ${skills.length} skills`;
  return (
    <View style={styles.qaGroup}>
      <Text accessibilityRole="header" style={styles.standupHeading}>
        On this host
      </Text>
      <Text style={styles.rowMeta}>Every agent of a tool that reads these folders has them.</Text>
      {skills.length === 0 ? <Text style={styles.muted}>No skills.</Text> : null}
      {skills.length > 0 && shown.length === 0 ? (
        <Text style={styles.muted}>None match.</Text>
      ) : null}
      {folded ? (
        <View style={styles.actions}>
          <ActionButton label={label} pendingLabel={label} onPress={toggle} styles={styles} />
        </View>
      ) : null}
      {!folded || open
        ? shown.map((skill) => <SkillRow key={skill.name} skill={skill} styles={styles} />)
        : null}
    </View>
  );
}

interface SkillsTabProps {
  teams: readonly LibraryTeam[];
  skills: SkillsResult | null;
  read: boolean | "failed";
  styles: OfficeStyles;
}

/** Every skill once: the workspaces' first, then the host's, with a search over both. */
function SkillsTab({ teams, skills, read, styles }: SkillsTabProps) {
  const [query, setQuery] = useState("");
  const inTeams = workspaceSkills(teams);
  const total = inTeams.length + (skills?.host.length ?? 0);
  const searching = query.trim() !== "";
  const teamRows = searching
    ? inTeams.filter((skill) => skillMatches(skill, query.trim()))
    : inTeams;
  const at = teams.flatMap((team) => team.atSkill);
  const unread = unreadLine(teams, read);
  return (
    <View style={styles.sheet}>
      {total < SEARCH_FROM ? null : (
        <TextInput
          accessibilityLabel="Search the skills"
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name or what it is for"
          placeholderTextColor={styles.placeholderColor}
          style={styles.searchInput}
        />
      )}
      {at.length === 0 ? null : <Text style={styles.rowMeta}>At a skill now: {at.join(", ")}</Text>}
      {teams.length === 0 ? null : (
        <View style={styles.qaGroup}>
          <Text accessibilityRole="header" style={styles.standupHeading}>
            {"In the teams' workspaces"}
          </Text>
          {unread === null ? null : <Text style={styles.muted}>{unread}</Text>}
          {read === true && inTeams.length === 0 ? (
            <Text style={styles.muted}>None yet. Ask a team for one under Teach a skill.</Text>
          ) : null}
          {searching && inTeams.length > 0 && teamRows.length === 0 ? (
            <Text style={styles.muted}>None match.</Text>
          ) : null}
          {teamRows.map((skill) => (
            <SkillRow
              key={`${skill.name} ${skill.teams.join()}`}
              skill={skill}
              where={skillTeams(skill.teams)}
              styles={styles}
            />
          ))}
        </View>
      )}
      {skills === null ? null : (
        <HostSkills
          skills={skills.host}
          query={query.trim()}
          afterTeams={teams.length > 0}
          styles={styles}
        />
      )}
    </View>
  );
}

export interface LibraryCardProps {
  teams: readonly LibraryTeam[];
  skills: SkillsResult | null;
  /** Why the last reading failed; null when it did not. */
  readFailure: string | null;
  open: boolean;
  read(): Promise<void>;
  teach(team: LibraryTeam, agentId: string, topic: string): Promise<void>;
  /** "Wake agents" is off: a request would wait, so nobody is asked. */
  wakesPaused: boolean;
  onOpenBoard(roomId: string): void;
  styles: OfficeStyles;
  onClose(): void;
}

/**
 * The library: the skills the teams' workspaces and the host have, who is at one now, and a request
 * to an idle agent to write a new one from its work.
 */
export function LibraryCard({
  teams,
  skills,
  readFailure,
  open,
  read,
  teach,
  wakesPaused,
  onOpenBoard,
  styles,
  onClose,
}: LibraryCardProps) {
  const [view, setView] = useState("skills");
  const change = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  return (
    <Modal title="Library" open={open} onOpenChange={change}>
      <Modal.Content>
        <View style={styles.sheet}>
          <View style={styles.sheetActions}>
            <View style={styles.libraryHead}>
              <View style={styles.libraryHeadText}>
                <Text style={styles.sheetText}>
                  {librarySummary(teams, skills, readFailure !== null)}
                </Text>
                {skills === null ? null : (
                  <Text style={styles.rowMeta}>
                    Read at {new Date(skills.readAt).toLocaleTimeString()}
                  </Text>
                )}
              </View>
              <ActionButton
                label="Read again"
                pendingLabel="Reading..."
                onPress={read}
                styles={styles}
              />
            </View>
            {readFailure ? (
              <Text accessibilityRole="alert" style={styles.actionError}>
                {readFailure}
              </Text>
            ) : null}
          </View>
          {/* Teaching asks a team's agent, which an office without a team cannot. */}
          {teams.length === 0 ? null : (
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Library view"
              style={styles.chips}
            >
              <Chip
                label="Skills"
                value="skills"
                selected={view === "skills"}
                onSelect={setView}
                styles={styles}
              />
              <Chip
                label="Teach a skill"
                value="teach"
                selected={view === "teach"}
                onSelect={setView}
                styles={styles}
              />
            </View>
          )}
          {view === "teach" && teams.length > 0 ? (
            <TeachTab
              teams={teams}
              wakesPaused={wakesPaused}
              teach={teach}
              onOpenBoard={onOpenBoard}
              styles={styles}
            />
          ) : (
            <SkillsTab
              teams={teams}
              skills={skills}
              read={skills === null && readFailure !== null ? "failed" : skills !== null}
              styles={styles}
            />
          )}
        </View>
      </Modal.Content>
    </Modal>
  );
}
