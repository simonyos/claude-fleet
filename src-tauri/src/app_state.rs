use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn config_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".claude-fleet"))
}

fn state_path() -> Result<PathBuf, String> {
    let dir = config_dir().ok_or_else(|| "HOME not set".to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("state.json"))
}

fn mailbox_root() -> Result<PathBuf, String> {
    let dir = config_dir().ok_or_else(|| "HOME not set".to_string())?;
    let root = dir.join("mail");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

fn safe_mailbox_segment(value: &str) -> String {
    let segment: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    if segment.is_empty() {
        "unknown".to_string()
    } else {
        segment
    }
}

fn expand_home(path: &str) -> PathBuf {
    if path == "~" {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home);
        }
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(path)
}

fn default_status() -> String {
    "idle".to_string()
}

fn default_role() -> String {
    "worker".to_string()
}

fn default_runtime() -> String {
    "claude".to_string()
}

fn default_agent_permissions() -> AgentPermissions {
    AgentPermissions {
        can_create_agents: false,
        can_manage_tasks: true,
    }
}

fn default_runtime_config() -> serde_json::Value {
    serde_json::json!({
        "heartbeat": {
            "enabled": false,
            "wakeOnDemand": true
        }
    })
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorkspace {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRecord {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub accent_color: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default = "default_runtime")]
    pub runtime: String,
    #[serde(default = "default_role")]
    pub role: String,
    #[serde(default)]
    pub reports_to: Option<String>,
    #[serde(default)]
    pub capabilities: Option<String>,
    pub cwd: Option<String>,
    pub worktree: Option<String>,
    pub instructions: Option<String>,
    #[serde(default)]
    pub instructions_bundle: Option<InstructionsBundle>,
    #[serde(default = "default_runtime_config")]
    pub runtime_config: serde_json::Value,
    #[serde(default = "default_agent_permissions")]
    pub permissions: AgentPermissions,
    #[serde(default)]
    pub source_task_id: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default = "default_status")]
    pub status: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstructionsBundle {
    pub files: std::collections::BTreeMap<String, String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPermissions {
    pub can_create_agents: bool,
    pub can_manage_tasks: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecord {
    pub id: String,
    pub title: String,
    pub body: String,
    pub status: String,
    pub assignee: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub owned_files: Vec<String>,
    #[serde(default)]
    pub acceptance_criteria: Vec<String>,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub review_notes: Option<String>,
    #[serde(default)]
    pub swarm_id: Option<String>,
    #[serde(default)]
    pub comments: Vec<TaskComment>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskComment {
    pub id: String,
    pub author: String,
    pub body: String,
    pub created_at: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRecord {
    pub id: String,
    pub from: String,
    pub to: String,
    pub body: String,
    pub created_at: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageRecord {
    pub id: String,
    pub role: String,
    pub body: String,
    pub created_at: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    pub id: String,
    pub agent_id: String,
    pub task_id: Option<String>,
    pub status: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub summary: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecord {
    pub id: String,
    pub agent_id: String,
    pub path: String,
    pub branch: String,
    pub created_at: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FleetState {
    pub schema_version: u32,
    #[serde(default)]
    pub active_workspace: Option<ProjectWorkspace>,
    #[serde(default)]
    pub main_agent_id: Option<String>,
    pub agents: Vec<AgentRecord>,
    pub tasks: Vec<TaskRecord>,
    #[serde(default)]
    pub orchestrator_chat: Vec<ChatMessageRecord>,
    pub messages: Vec<MessageRecord>,
    pub runs: Vec<RunRecord>,
    pub workspaces: Vec<WorkspaceRecord>,
}

fn default_state() -> FleetState {
    FleetState {
        schema_version: 3,
        active_workspace: None,
        main_agent_id: None,
        agents: vec![],
        tasks: vec![],
        orchestrator_chat: vec![],
        messages: vec![],
        runs: vec![],
        workspaces: vec![],
    }
}

fn timestamp_id() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn normalize_task_status(status: Option<&str>) -> String {
    match status.unwrap_or("todo") {
        "todo" => "todo".to_string(),
        "in-progress" => "in-progress".to_string(),
        "in-review" => "in-review".to_string(),
        "blocked" => "blocked".to_string(),
        "complete" | "completed" => "done".to_string(),
        "done" => "done".to_string(),
        _ => "todo".to_string(),
    }
}

fn normalize_runtime(runtime: Option<&str>) -> String {
    match runtime.unwrap_or("claude") {
        "claude" => "claude".to_string(),
        "codex" => "codex".to_string(),
        _ => "claude".to_string(),
    }
}

fn agent_label_by_id(state: &FleetState, id: &str) -> String {
    state
        .agents
        .iter()
        .find(|agent| agent.id == id)
        .map(|agent| agent.label.clone())
        .unwrap_or_else(|| id.to_string())
}

fn write_mailbox_files(message: &MessageRecord) -> Result<(), String> {
    let root = mailbox_root()?;
    let from = safe_mailbox_segment(&message.from);
    let to = safe_mailbox_segment(&message.to);
    let json = serde_json::to_string_pretty(message).map_err(|e| e.to_string())?;

    let global_dir = root.join("messages");
    let inbox_dir = root.join("agents").join(&to).join("inbox");
    let outbox_dir = root.join("agents").join(&from).join("outbox");

    fs::create_dir_all(&global_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&inbox_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&outbox_dir).map_err(|e| e.to_string())?;

    let filename = format!("{}.json", safe_mailbox_segment(&message.id));
    fs::write(global_dir.join(&filename), &json).map_err(|e| e.to_string())?;
    fs::write(inbox_dir.join(&filename), &json).map_err(|e| e.to_string())?;
    fs::write(outbox_dir.join(&filename), &json).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn record_message(from: String, to: String, body: String) -> Result<MessageRecord, String> {
    let mut state = load_fleet_state()?;
    let timestamp = timestamp_id();
    let message = MessageRecord {
        id: format!("message-{}", timestamp),
        from,
        to,
        body,
        created_at: timestamp,
    };
    write_mailbox_files(&message)?;
    state.messages.insert(
        0,
        message.clone(),
    );
    save_fleet_state(state)?;
    Ok(message)
}

#[tauri::command]
pub fn record_manual_message(from: String, to: String, body: String) -> Result<MessageRecord, String> {
    record_message(from, to, body)
}

#[tauri::command]
pub fn get_mailbox_root() -> Result<String, String> {
    Ok(mailbox_root()?.to_string_lossy().to_string())
}

pub fn list_agents_for_mcp() -> Result<String, String> {
    let state = load_fleet_state()?;
    let agents: Vec<_> = state
        .agents
        .iter()
        .map(|agent| {
            serde_json::json!({
                "id": agent.id,
                "label": agent.label,
                "accentColor": agent.accent_color,
                "title": agent.title,
                "role": agent.role,
                "runtime": agent.runtime,
                "status": agent.status,
                "reportsTo": agent.reports_to,
                "capabilities": agent.capabilities,
                "cwd": agent.cwd,
                "sourceTaskId": agent.source_task_id,
                "sessionId": agent.session_id,
            })
        })
        .collect();
    serde_json::to_string_pretty(&agents).map_err(|e| e.to_string())
}

pub fn list_messages_for_mcp() -> Result<String, String> {
    let state = load_fleet_state()?;
    let messages: Vec<_> = state
        .messages
        .iter()
        .take(50)
        .map(|message| {
            serde_json::json!({
                "id": message.id,
                "from": message.from,
                "to": message.to,
                "body": message.body,
                "createdAt": message.created_at,
            })
        })
        .collect();
    serde_json::to_string_pretty(&messages).map_err(|e| e.to_string())
}

pub fn list_tasks_for_mcp() -> Result<String, String> {
    let state = load_fleet_state()?;
    let tasks: Vec<_> = state
        .tasks
        .iter()
        .map(|task| {
            serde_json::json!({
                "id": task.id,
                "title": task.title,
                "body": task.body,
                "status": task.status,
                "assignee": task.assignee,
                "role": task.role,
                "ownedFiles": task.owned_files,
                "acceptanceCriteria": task.acceptance_criteria,
                "dependsOn": task.depends_on,
                "reviewNotes": task.review_notes,
                "swarmId": task.swarm_id,
                "comments": task.comments,
                "createdAt": task.created_at,
                "updatedAt": task.updated_at,
            })
        })
        .collect();
    serde_json::to_string_pretty(&tasks).map_err(|e| e.to_string())
}

pub fn create_task_from_mcp(
    title: String,
    body: Option<String>,
    assignee: Option<String>,
    role: Option<String>,
    owned_files: Vec<String>,
    acceptance_criteria: Vec<String>,
    depends_on: Vec<String>,
    review_notes: Option<String>,
    swarm_id: Option<String>,
    author: String,
) -> Result<String, String> {
    let mut state = load_fleet_state()?;
    if let Some(agent_id) = assignee.as_deref() {
        if !state.agents.iter().any(|agent| agent.id == agent_id) {
            return Err(format!("unknown assignee: {}", agent_id));
        }
    }

    let timestamp = timestamp_id();
    let task = TaskRecord {
        id: format!("task-{}", timestamp),
        title: title.trim().to_string(),
        body: body.unwrap_or_default(),
        status: "todo".to_string(),
        assignee,
        role,
        owned_files,
        acceptance_criteria,
        depends_on,
        review_notes,
        swarm_id,
        comments: vec![TaskComment {
            id: format!("comment-{}", timestamp),
            author,
            body: "Task created via agent tool.".to_string(),
            created_at: timestamp.clone(),
        }],
        created_at: timestamp.clone(),
        updated_at: timestamp,
    };
    let id = task.id.clone();
    state.tasks.insert(0, task);
    save_fleet_state(state)?;
    Ok(format!("Created task {}", id))
}

pub fn update_task_from_mcp(
    task_id: String,
    title: Option<String>,
    body: Option<String>,
    status: Option<String>,
    assignee: Option<String>,
    role: Option<String>,
    owned_files: Option<Vec<String>>,
    acceptance_criteria: Option<Vec<String>>,
    depends_on: Option<Vec<String>>,
    review_notes: Option<String>,
    swarm_id: Option<String>,
) -> Result<String, String> {
    let mut state = load_fleet_state()?;
    if let Some(agent_id) = assignee.as_deref() {
        if !agent_id.is_empty() && !state.agents.iter().any(|agent| agent.id == agent_id) {
            return Err(format!("unknown assignee: {}", agent_id));
        }
    }

    let task = state
        .tasks
        .iter_mut()
        .find(|task| task.id == task_id)
        .ok_or_else(|| format!("unknown task: {}", task_id))?;
    if let Some(value) = title {
        task.title = value;
    }
    if let Some(value) = body {
        task.body = value;
    }
    if let Some(value) = status {
        task.status = normalize_task_status(Some(&value));
    }
    if let Some(value) = assignee {
        task.assignee = if value.is_empty() { None } else { Some(value) };
    }
    if let Some(value) = role {
        task.role = if value.is_empty() { None } else { Some(value) };
    }
    if let Some(value) = owned_files {
        task.owned_files = value;
    }
    if let Some(value) = acceptance_criteria {
        task.acceptance_criteria = value;
    }
    if let Some(value) = depends_on {
        task.depends_on = value;
    }
    if let Some(value) = review_notes {
        task.review_notes = if value.is_empty() { None } else { Some(value) };
    }
    if let Some(value) = swarm_id {
        task.swarm_id = if value.is_empty() { None } else { Some(value) };
    }
    task.updated_at = timestamp_id();
    save_fleet_state(state)?;
    Ok(format!("Updated task {}", task_id))
}

pub fn comment_task_from_mcp(task_id: String, body: String, author: String) -> Result<String, String> {
    let mut state = load_fleet_state()?;
    let task = state
        .tasks
        .iter_mut()
        .find(|task| task.id == task_id)
        .ok_or_else(|| format!("unknown task: {}", task_id))?;
    let timestamp = timestamp_id();
    task.comments.insert(
        0,
        TaskComment {
            id: format!("comment-{}", timestamp),
            author,
            body,
            created_at: timestamp.clone(),
        },
    );
    task.updated_at = timestamp_id();
    save_fleet_state(state)?;
    Ok(format!("Commented on task {}", task_id))
}

pub fn request_hire_agent_from_mcp(
    requested_by: String,
    label: String,
    runtime: Option<String>,
    role: Option<String>,
    title: Option<String>,
    reports_to: Option<String>,
    capabilities: Option<String>,
    instructions: Option<String>,
    source_task_id: Option<String>,
) -> Result<String, String> {
    let mut state = load_fleet_state()?;
    let requester = state
        .agents
        .iter()
        .find(|agent| agent.id == requested_by)
        .ok_or_else(|| format!("unknown requesting agent: {}", requested_by))?;
    if !requester.permissions.can_create_agents && requester.role != "orchestrator" {
        return Err("only the orchestrator or agents with canCreateAgents can request hires".to_string());
    }
    let manager_id = reports_to.unwrap_or_else(|| requested_by.clone());
    if !state.agents.iter().any(|agent| agent.id == manager_id) {
        return Err(format!("unknown manager: {}", manager_id));
    }
    if let Some(task_id) = source_task_id.as_deref() {
        if !state.tasks.iter().any(|task| task.id == task_id) {
            return Err(format!("unknown source task: {}", task_id));
        }
    }

    let timestamp = timestamp_id();
    let runtime = normalize_runtime(runtime.as_deref());
    let role = role.unwrap_or_else(|| "worker".to_string());
    let trimmed_instructions = instructions.unwrap_or_default();
    let mut files = std::collections::BTreeMap::new();
    if !trimmed_instructions.trim().is_empty() {
        files.insert("AGENTS.md".to_string(), trimmed_instructions.clone());
    }
    let agent = AgentRecord {
        id: format!("agent-{}", timestamp),
        label: label.trim().to_string(),
        accent_color: Some("#4ebe96".to_string()),
        title,
        runtime,
        role,
        reports_to: Some(manager_id.clone()),
        capabilities,
        cwd: state.active_workspace.as_ref().map(|workspace| workspace.path.clone()),
        worktree: None,
        instructions: if trimmed_instructions.trim().is_empty() {
            None
        } else {
            Some(trimmed_instructions)
        },
        instructions_bundle: if files.is_empty() {
            None
        } else {
            Some(InstructionsBundle { files })
        },
        runtime_config: default_runtime_config(),
        permissions: AgentPermissions {
            can_create_agents: false,
            can_manage_tasks: true,
        },
        source_task_id,
        session_id: None,
        status: "pending_approval".to_string(),
    };
    let id = agent.id.clone();
    let summary = format!(
        "Pending hire {} ({}) requested by {}. Manager: {}.",
        agent.label,
        agent.role,
        agent_label_by_id(&state, &requested_by),
        agent_label_by_id(&state, &manager_id)
    );
    state.agents.push(agent);
    let run = RunRecord {
        id: format!("run-{}", timestamp),
        agent_id: requested_by,
        task_id: None,
        status: "hire-requested".to_string(),
        started_at: timestamp.clone(),
        ended_at: Some(timestamp.clone()),
        summary: Some(summary),
    };
    state.runs.insert(0, run);
    save_fleet_state(state)?;
    Ok(format!("Created pending hire {}. Ask the user to review and approve it in the app before using this agent.", id))
}

#[tauri::command]
pub fn load_fleet_state() -> Result<FleetState, String> {
    let path = state_path()?;
    if !path.exists() {
        let state = default_state();
        save_fleet_state(state.clone())?;
        return Ok(state);
    }

    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut state: FleetState = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if state.main_agent_id.is_none() {
        state.main_agent_id = state.agents.first().map(|agent| agent.id.clone());
    }
    Ok(state)
}

#[tauri::command]
pub fn save_fleet_state(state: FleetState) -> Result<(), String> {
    let path = state_path()?;
    let text = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_project_workspace(path: String) -> Result<ProjectWorkspace, String> {
    let expanded = expand_home(path.trim());
    if !expanded.exists() {
        return Err("project path does not exist".to_string());
    }
    if !expanded.is_dir() {
        return Err("project path is not a directory".to_string());
    }
    let canonical = expanded.canonicalize().map_err(|e| e.to_string())?;
    let name = canonical
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "Workspace".to_string());
    Ok(ProjectWorkspace {
        id: format!("workspace-{}", timestamp_id()),
        name,
        path: canonical.to_string_lossy().to_string(),
        created_at: timestamp_id(),
    })
}

#[tauri::command]
pub fn create_project_workspace(path: String, name: Option<String>) -> Result<ProjectWorkspace, String> {
    let expanded = expand_home(path.trim());
    fs::create_dir_all(&expanded).map_err(|e| e.to_string())?;
    let canonical = expanded.canonicalize().map_err(|e| e.to_string())?;
    let workspace_name = name
        .and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() { None } else { Some(trimmed) }
        })
        .or_else(|| canonical.file_name().map(|value| value.to_string_lossy().to_string()))
        .unwrap_or_else(|| "Workspace".to_string());
    Ok(ProjectWorkspace {
        id: format!("workspace-{}", timestamp_id()),
        name: workspace_name,
        path: canonical.to_string_lossy().to_string(),
        created_at: timestamp_id(),
    })
}
