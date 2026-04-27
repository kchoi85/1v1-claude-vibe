# Multiplayer POC Deployment

This project can run as one free Render web service. The server serves the built client from `client/dist` and accepts WebSocket traffic from the same public URL.

## Render

1. Push this repository to GitHub.
2. Open Render and create a new Blueprint from the repository.
3. Render will read `render.yaml`.
4. Use the free instance type.
5. After deploy, open the Render URL and use the copy-link button on the join screen.

Free web services can spin down when idle, so the first load after inactivity can take a little while.
