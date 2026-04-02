import React, { useState } from 'react'

interface Skill {
  name: string
  source: 'bundled' | 'project' | 'user' | 'plugin'
  description: string
  trigger: string
  active: boolean
  usageCount: number
}

interface Agent {
  name: string
  type: 'built-in' | 'custom'
  description: string
  model?: string
  tools: string[]
  active: boolean
}

const DEMO_SKILLS: Skill[] = [
  { name: 'create-react-app', source: 'bundled', description: '创建 React 应用项目模板', trigger: '自动', active: true, usageCount: 12 },
  { name: 'git-workflow', source: 'bundled', description: 'Git 提交、分支、PR 工作流', trigger: '自动', active: true, usageCount: 34 },
  { name: 'test-runner', source: 'bundled', description: '运行和分析测试套件', trigger: '自动', active: true, usageCount: 8 },
  { name: 'docker-deploy', source: 'project', description: 'Docker 容器化部署', trigger: '.claude/skills/docker', active: true, usageCount: 3 },
  { name: 'api-docs', source: 'user', description: '自动生成 API 文档', trigger: '~/.claude/skills/api-docs', active: false, usageCount: 0 },
  { name: 'lint-fix', source: 'plugin', description: '自动修复 lint 错误', trigger: 'plugin: code-quality', active: true, usageCount: 21 },
]

const DEMO_AGENTS: Agent[] = [
  { name: 'CodeAgent', type: 'built-in', description: '通用代码编写代理', tools: ['Bash', 'Edit', 'Read', 'Grep', 'Glob'], active: true },
  { name: 'TestAgent', type: 'built-in', description: '测试编写和运行代理', tools: ['Bash', 'Read', 'Edit'], active: true },
  { name: 'ReviewAgent', type: 'built-in', description: '代码审查代理', tools: ['Read', 'Grep', 'Glob'], active: true },
  { name: 'DocAgent', type: 'custom', description: '文档生成代理', model: 'minimax-m2.7', tools: ['Read', 'Edit', 'Glob'], active: false },
]

const SOURCE_META: Record<string, { icon: string; label: string; color: string }> = {
  bundled: { icon: '📦', label: '内置', color: '#0a84ff' },
  project: { icon: '📁', label: '项目', color: '#30d158' },
  user: { icon: '👤', label: '用户', color: '#ff9f0a' },
  plugin: { icon: '🧩', label: '插件', color: '#bf5af2' },
}

export function SkillsAgentsPage() {
  const [activeTab, setActiveTab] = useState<'skills' | 'agents'>('skills')
  const [skills] = useState<Skill[]>(DEMO_SKILLS)
  const [agents] = useState<Agent[]>(DEMO_AGENTS)

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">
          {activeTab === 'skills' ? '🧩 技能中心' : '🤖 代理管理'}
        </h1>
        <div className="page-header-actions">
          <div className="btn-group">
            <button
              className={`btn-toggle ${activeTab === 'skills' ? 'active' : ''}`}
              onClick={() => setActiveTab('skills')}
            >🧩 技能</button>
            <button
              className={`btn-toggle ${activeTab === 'agents' ? 'active' : ''}`}
              onClick={() => setActiveTab('agents')}
            >🤖 代理</button>
          </div>
        </div>
      </div>

      <div className="page-body">
        {activeTab === 'skills' ? (
          <div className="skills-grid">
            {skills.map(skill => {
              const src = SOURCE_META[skill.source]
              return (
                <div key={skill.name} className={`skill-card ${skill.active ? '' : 'inactive'}`}>
                  <div className="skill-card-header">
                    <span className="skill-card-name">{skill.name}</span>
                    <span className="skill-card-source" style={{ color: src.color }}>
                      {src.icon} {src.label}
                    </span>
                  </div>
                  <div className="skill-card-desc">{skill.description}</div>
                  <div className="skill-card-footer">
                    <span className="skill-card-trigger">触发: {skill.trigger}</span>
                    <span className="skill-card-usage">使用 {skill.usageCount} 次</span>
                    <label className="toggle-switch">
                      <input type="checkbox" checked={skill.active} readOnly />
                      <span className="toggle-slider" />
                    </label>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="agents-grid">
            {agents.map(agent => (
              <div key={agent.name} className={`agent-card ${agent.active ? '' : 'inactive'}`}>
                <div className="agent-card-header">
                  <span className="agent-icon">
                    {agent.type === 'built-in' ? '🤖' : '🛠'}
                  </span>
                  <span className="agent-card-name">{agent.name}</span>
                  <span className={`agent-card-type type-${agent.type}`}>
                    {agent.type === 'built-in' ? '内置' : '自定义'}
                  </span>
                </div>
                <div className="agent-card-desc">{agent.description}</div>
                {agent.model && (
                  <div className="agent-card-model">模型: {agent.model}</div>
                )}
                <div className="agent-card-tools">
                  {agent.tools.map(t => (
                    <span key={t} className="agent-tool-tag">{t}</span>
                  ))}
                </div>
                <div className="agent-card-footer">
                  <label className="toggle-switch">
                    <input type="checkbox" checked={agent.active} readOnly />
                    <span className="toggle-slider" />
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
