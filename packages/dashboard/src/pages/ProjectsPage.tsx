import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, FolderOpen, Pencil } from 'lucide-react';
import { getProjects, deleteProject, type Project } from '../api';

export function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      setProjects(await getProjects());
    } finally { setLoading(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this project?')) return;
    try {
      await deleteProject(id);
      setProjects(p => p.filter(x => x.id !== id));
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Error deleting project');
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Projects</h1>
        <p>Client applications that access LocalRouter</p>
      </div>
      {err && <div className="form-error" style={{ margin: '0 20px' }}>{err}</div>}
      <div className="page-body">
        <div className="toolbar">
          <span className="toolbar-title">{projects.length} project{projects.length !== 1 ? 's' : ''}</span>
          <button className="btn btn-primary" onClick={() => navigate('/dashboard/projects/new')}>
            <Plus size={16} /> New Project
          </button>
        </div>

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : projects.length === 0 ? (
          <div className="empty-state"><FolderOpen size={40} /><p>No projects yet.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Token</th><th>Routing Model</th><th>Models</th><th></th></tr>
              </thead>
              <tbody>
                {projects.map(p => (
                  <tr key={p.id}>
                    <td><strong style={{ color: 'var(--text-primary)' }}>{p.name}</strong></td>
                    <td>
                      <span className="mono" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {p.tokenSnippet ? `${p.tokenSnippet}...` : '••••••••••'}
                      </span>
                    </td>
                    <td><span className="mono" style={{ fontSize: '0.78rem' }}>{p.routingModelId}</span></td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      {p.models.map(m => m.modelId).join(', ')}
                    </td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button className="btn-icon" onClick={() => navigate(`/dashboard/projects/${p.id}`)} title="Edit project">
                        <Pencil size={15} />
                      </button>
                      <button className="btn-icon danger" onClick={() => handleDelete(p.id)} title="Delete project">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
