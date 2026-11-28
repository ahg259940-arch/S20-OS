const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const authorization = require("./authorization.js");
const audit = require("./audit.js");
const contextManager = require("./context-scope.js");

const repositoryPath = path.resolve(__dirname, "..");
const repositoryRoot = fs.realpathSync(repositoryPath);
const defaultWorkspaceRoot = path.join(repositoryRoot, "workspace");
const defaultProjectsRoot = path.join(defaultWorkspaceRoot, "projects");

function getWorkspaceRoot() {
  return path.dirname(getProjectsRoot());
}

function getProjectsRoot() {
  return contextManager.resolveDataPath("projects", defaultProjectsRoot);
}
const MAX_FILE_BYTES = 512 * 1024;
const MAX_PROJECT_FILES = 100;
const MAX_PROJECT_BYTES = 2 * 1024 * 1024;

function makeSlug(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function proposeProject({ name, description, kind = "tool", goals = [] } = {}) {
  if (typeof name !== "string" || !name.trim() ||
      typeof description !== "string" || !description.trim()) {
    return { success: false, message: "Informe um nome e uma descrição para o projeto." };
  }
  const slug = makeSlug(name);
  if (!slug) return { success: false, message: "O nome não gerou um identificador válido." };

  const proposalId = crypto.randomUUID();
  const proposal = {
    success: true,
    proposal: {
      id: proposalId,
      name: name.trim(),
      slug,
      description: description.trim(),
      kind: String(kind).trim() || "tool",
      goals: Array.isArray(goals) ? goals.filter(item => typeof item === "string") : [],
      requiresHumanApproval: true,
      proposedAt: new Date().toISOString(),
      files: {
        "README.md": `# ${name.trim()}\n\n${description.trim()}\n\n## Estado\n\nEstrutura inicial; nenhum código foi executado.\n`,
        "src/main.js": "// Ponto inicial do projeto. Revise antes de executar.\n",
        "project.json": JSON.stringify({
          id: proposalId,
          name: name.trim(),
          description: description.trim(),
          kind: String(kind).trim() || "tool",
          status: "scaffold"
        }, null, 2) + "\n"
      }
    }
  };
  return audit.executeAudited("project_proposed", { identifier: proposal.proposal.id }, () => proposal);
}

function validateSlug(slug) {
  return typeof slug === "string" && slug.length > 0 && makeSlug(slug) === slug;
}

function validateRelativeFilePath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath.trim() ||
      path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    return { safe: false, reason: "Caminho absoluto ou vazio." };
  }
  const normalized = relativePath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (segments.some(part => !part || part === "." || part === ".." || /[\0-\x1f]/.test(part))) {
    return { safe: false, reason: "O caminho contém segmento inválido." };
  }
  return { safe: true, normalized };
}

function ensureWorkspaceRoot(create = false) {
  const defaultRoot = fs.realpathSync(repositoryPath);
  const contextRoot = contextManager.getCurrentDataRoot();
  const authorizedParent = contextRoot ? path.resolve(contextRoot) : defaultRoot;
  if (create && contextRoot) contextManager.ensureCurrentDataRoot();
  const workspace = getWorkspaceRoot();
  const projects = getProjectsRoot();
  const expectedWorkspace = path.join(authorizedParent, "workspace");
  const expectedProjects = path.join(expectedWorkspace, "projects");
  if (path.resolve(workspace) !== expectedWorkspace || path.resolve(projects) !== expectedProjects) {
    throw new Error("A raiz de projetos não corresponde ao contexto ativo.");
  }

  let current = authorizedParent;
  for (const [directoryName, expected] of [["workspace", expectedWorkspace], ["projects", expectedProjects]]) {
    current = path.join(current, directoryName);
    let stats;
    try {
      stats = fs.lstatSync(current);
    } catch (error) {
      if (error.code !== "ENOENT" || !create) {
        if (error.code === "ENOENT") return { ready: false, path: expectedProjects };
        throw error;
      }
      fs.mkdirSync(current);
      stats = fs.lstatSync(current);
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error("A raiz de projetos contém um link simbólico ou não é um diretório.");
    }
    const realCurrent = fs.realpathSync(current);
    const realParent = fs.realpathSync(path.dirname(expected));
    if (realCurrent !== expected || path.dirname(realCurrent) !== realParent) {
      throw new Error("A raiz real de projetos saiu do contexto autorizado.");
    }
    current = realCurrent;
  }
  return { ready: true, path: current };
}

function inspectProjectDestination(slug) {
  if (!validateSlug(slug)) return { safe: false, status: "invalid_slug" };
  try {
    const root = ensureWorkspaceRoot(false);
    if (!root.ready) return { safe: true, exists: false, path: path.join(root.path, slug) };
    const projectPath = path.join(root.path, slug);
    if (!projectPath.startsWith(root.path + path.sep)) return { safe: false, status: "outside_workspace" };
    try {
      const stats = fs.lstatSync(projectPath);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        return { safe: false, status: "unsafe_existing_path" };
      }
      const realProject = fs.realpathSync(projectPath);
      if (!realProject.startsWith(root.path + path.sep)) return { safe: false, status: "outside_workspace" };
      return { safe: true, exists: true, path: realProject };
    } catch (error) {
      if (error.code === "ENOENT") return { safe: true, exists: false, path: projectPath };
      throw error;
    }
  } catch (_error) {
    return { safe: false, status: "unsafe_workspace_root" };
  }
}

function validateProposal(proposal) {
  if (!proposal || !validateSlug(proposal.slug) ||
      typeof proposal.id !== "string" || !proposal.id ||
      !proposal.files || typeof proposal.files !== "object" || Array.isArray(proposal.files)) {
    return { success: false, status: "invalid_proposal", message: "A proposta do projeto é inválida." };
  }
  const entries = Object.entries(proposal.files);
  if (entries.length === 0 || entries.length > MAX_PROJECT_FILES) {
    return { success: false, status: "invalid_file_count", message: `O projeto deve conter de 1 a ${MAX_PROJECT_FILES} arquivos.` };
  }
  let totalBytes = 0;
  const seen = new Set();
  const normalizedFiles = [];
  for (const [filePath, content] of entries) {
    const validPath = validateRelativeFilePath(filePath);
    if (!validPath.safe || typeof content !== "string") {
      return { success: false, status: "invalid_file", message: validPath.reason || "Conteúdo de arquivo inválido." };
    }
    const key = validPath.normalized.toLowerCase();
    if (seen.has(key)) return { success: false, status: "duplicate_file_path", message: "A proposta contém caminhos duplicados." };
    seen.add(key);
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_FILE_BYTES) return { success: false, status: "file_too_large", message: "Um arquivo excede o limite individual." };
    totalBytes += bytes;
    normalizedFiles.push([validPath.normalized, content]);
  }
  if (totalBytes > MAX_PROJECT_BYTES) return { success: false, status: "project_too_large", message: "O conteúdo excede o limite total do projeto." };
  return { success: true, normalizedFiles, totalBytes };
}

function createProject(proposal, approval) {
  const validation = validateProposal(proposal);
  if (!validation.success) return validation;

  const boundContent = {
    id: proposal.id,
    slug: proposal.slug,
    name: proposal.name,
    description: proposal.description,
    files: validation.normalizedFiles
  };
  const auth = authorization.verifyAuthorization({
    operation: "create_project",
    proposalId: proposal.id,
    contentDigest: authorization.digestContent(boundContent),
    approval
  });
  if (!auth.authorized) {
    return {
      success: false,
      status: auth.status,
      requiresHumanApproval: true,
      message: auth.reason
    };
  }

  return audit.executeAudited("project_scaffold_created", {
    identifier: proposal.id,
    contentDigest: auth.contentDigest
  }, () => createProjectFiles(proposal, validation.normalizedFiles));
}

function assertSafeProjectParents(projectPath) {
  const rootInfo = ensureWorkspaceRoot(false);
  if (!rootInfo.ready) throw new Error("A raiz de projetos ainda não existe.");
  const realRoot = rootInfo.path;
  const relative = path.relative(realRoot, projectPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Caminho fora da raiz autorizada.");
  let current = realRoot;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error("Links simbólicos não são permitidos no caminho do projeto.");
    const realCurrent = fs.realpathSync(current);
    if (!realCurrent.startsWith(realRoot + path.sep)) throw new Error("Caminho real fora da raiz autorizada.");
  }
}

function createProjectFiles(proposal, files) {
  const writtenFiles = [];
  let projectDirectory;
  try {
    const rootInfo = ensureWorkspaceRoot(true);
    projectDirectory = path.join(rootInfo.path, proposal.slug);
    if (fs.existsSync(projectDirectory)) {
      return { success: false, status: "project_already_exists", message: "O projeto já existe; nenhum arquivo foi substituído." };
    }
    fs.mkdirSync(projectDirectory);
    assertSafeProjectParents(projectDirectory);
    for (const [relativePath, content] of files) {
      const destination = path.resolve(projectDirectory, relativePath);
      if (!destination.startsWith(projectDirectory + path.sep)) throw new Error("Caminho fora do projeto.");
      const parent = path.dirname(destination);
      fs.mkdirSync(parent, { recursive: true });
      assertSafeProjectParents(parent);
      fs.writeFileSync(destination, content, { encoding: "utf8", flag: "wx" });
      writtenFiles.push(relativePath);
    }
  } catch (_error) {
    return {
      success: false,
      status: writtenFiles.length ? "partial_project_created" : "project_creation_failed",
      requiresRecovery: Boolean(projectDirectory && fs.existsSync(projectDirectory)),
      projectPath: projectDirectory,
      writtenFiles,
      message: "A criação foi interrompida por uma falha de caminho ou gravação. Revise o estado; nenhum arquivo foi removido ou sobrescrito."
    };
  }
  return {
    success: true,
    status: "project_scaffold_created",
    projectPath: projectDirectory,
    writtenFiles,
    executionPerformed: false
  };
}

function validateProject(slug) {
  const destination = inspectProjectDestination(slug);
  if (!destination.safe) return { success: false, status: destination.status, issues: ["Caminho de projeto inseguro."] };
  if (!destination.exists) return { success: false, status: "project_not_found", issues: ["Projeto não encontrado."] };

  const files = [];
  const issues = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        issues.push(`Link simbólico ignorado: ${path.relative(destination.path, fullPath)}`);
      } else if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const relativePath = path.relative(destination.path, fullPath);
        files.push(relativePath);
        if (relativePath.endsWith(".js")) {
          try {
            new vm.Script(fs.readFileSync(fullPath, "utf8"), { filename: relativePath });
          } catch (error) {
            issues.push(`Erro de sintaxe em ${relativePath}: ${error.message}`);
          }
        }
      }
    }
  }
  walk(destination.path);
  return {
    success: issues.length === 0,
    status: issues.length === 0 ? "project_structure_valid" : "project_needs_review",
    files,
    issues,
    codeExecuted: false,
    validatedAt: new Date().toISOString()
  };
}

module.exports = {
  proposeProject,
  createProject,
  validateProject,
  makeSlug,
  validateRelativeFilePath,
  validateProposal,
  inspectProjectDestination
};
