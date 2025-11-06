#!/bin/bash
# Start Jupyter Lab for IMU data analysis

# Activate analysis environment
source ../venv-analysis/bin/activate

# Start Jupyter Lab
echo "Starting JupyterLab..."
echo "Open http://localhost:8888 in your browser"
echo "Notebooks are in: analysis/notebooks/"
echo ""
jupyter lab --notebook-dir=.
