import { Hono } from 'hono';
import { AGENT_REGISTRY } from '../../agents/registry.js';

export function agentRoutes(): Hono {
  const app = new Hono();

  app.get('/api/agents', (c) => {
    const agents = AGENT_REGISTRY.map(a => ({
      name: a.name,
      category: a.category,
      price: a.price,
      quality: a.quality,
      description: a.description,
      dataSources: a.dataSources,
      port: a.port,
    }));
    return c.json({ agents, count: agents.length });
  });

  app.get('/api/agents/:name', (c) => {
    const name = c.req.param('name');
    const agent = AGENT_REGISTRY.find(a => a.name.toLowerCase() === name.toLowerCase());
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    return c.json({
      name: agent.name,
      category: agent.category,
      price: agent.price,
      quality: agent.quality,
      description: agent.description,
      dataSources: agent.dataSources,
      port: agent.port,
    });
  });

  return app;
}
