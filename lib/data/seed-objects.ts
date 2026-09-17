import type { ObjectStatus } from "../types/object";

export interface SeedChecklistItem {
  title: string;
  completed: boolean;
}

export interface SeedObject {
  id: string;
  title: string;
  status: ObjectStatus;
  goal: string;
  currentState: string;
  nextAction: string;
  checklist: SeedChecklistItem[];
}

function makeChecklist(
  titles: string[],
  completedCount: number,
): SeedChecklistItem[] {
  return titles.map((title, index) => ({
    title,
    completed: index < completedCount,
  }));
}

/**
 * Reusable development fixture — the Phase 1 example Objects. Used by the seed
 * script and available for future test/reset workflows. Each Object remains
 * one complete thing while carrying an internal checklist of many steps.
 */
export const seedObjects: SeedObject[] = [
  {
    id: "obj-table",
    title: "Make a table",
    status: "doing",
    goal: "Build a 120 × 60 cm pine computer desk and finish it by the end of the month.",
    currentState: "The desk legs have been cut.",
    nextAction: "Sand the desk legs.",
    checklist: makeChecklist(
      [
        "Determine dimensions",
        "Design structure",
        "Choose material",
        "Buy material",
        "Cut wood",
        "Cut desk legs",
        "Sand",
        "Assemble",
        "Finish surface",
      ],
      6,
    ),
  },
  {
    id: "obj-video",
    title: "Make a video",
    status: "idea",
    goal: "Publish a 10-minute explainer video documenting the desk build.",
    currentState: "Planning",
    nextAction: "Choose the topic and write a rough outline.",
    checklist: makeChecklist(
      ["Choose topic", "Write outline", "Record footage", "Edit video", "Publish"],
      0,
    ),
  },
  {
    id: "obj-website",
    title: "Build a website",
    status: "doing",
    goal: "Launch a personal portfolio site with a blog and a contact form.",
    currentState: "Coding the homepage layout.",
    nextAction: "Test the contact form.",
    checklist: makeChecklist(
      [
        "Pick a stack",
        "Set up repository",
        "Design layout",
        "Build navigation",
        "Build homepage",
        "Build work page",
        "Build blog page",
        "Add contact form",
        "Wire up form handling",
        "Write initial posts",
        "Add responsive styles",
        "Deploy to production",
      ],
      8,
    ),
  },
  {
    id: "obj-exam",
    title: "Prepare for an exam",
    status: "ready",
    goal: "Pass the cloud architecture certification exam next month.",
    currentState: "Collected the study materials.",
    nextAction: "Create a study schedule.",
    checklist: makeChecklist(
      [
        "Gather materials",
        "Create study schedule",
        "Review core services",
        "Practice networking",
        "Practice security",
        "Take practice test 1",
        "Take practice test 2",
        "Schedule the exam",
      ],
      1,
    ),
  },
  {
    id: "obj-computer",
    title: "Buy a computer",
    status: "waiting",
    goal: "Buy a desktop computer suitable for video editing.",
    currentState: "Waiting for the new model to be released.",
    nextAction: "Compare prices once the new model is available.",
    checklist: makeChecklist(
      ["Set budget", "Choose specs", "Compare models", "Place order", "Set up machine"],
      3,
    ),
  },
  {
    id: "obj-room",
    title: "Renovate a room",
    status: "done",
    goal: "Turn the spare room into a comfortable home office.",
    currentState: "The room is painted and the furniture is assembled.",
    nextAction: "None — the room is finished.",
    checklist: makeChecklist(
      [
        "Choose color",
        "Clear the room",
        "Paint walls",
        "Install lighting",
        "Build desk",
        "Build shelves",
        "Route cables",
        "Move in furniture",
        "Decorate",
        "Final cleanup",
      ],
      10,
    ),
  },
];
