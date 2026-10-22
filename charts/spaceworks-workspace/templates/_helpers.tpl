{{- define "sww.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "sww.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else if contains (include "sww.name" .) .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name (include "sww.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "sww.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{ include "sww.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "sww.selectorLabels" -}}
app.kubernetes.io/name: {{ include "sww.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/* The Secret holding the runtime environment. */}}
{{- define "sww.secretName" -}}
{{- if .Values.secret.create }}
{{- printf "%s-runtime" (include "sww.fullname" .) }}
{{- else }}
{{- required "Set existingSecret (or secret.create=true with secret.data)" .Values.existingSecret }}
{{- end }}
{{- end }}

{{- define "sww.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "sww.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "sww.image" -}}
{{- printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) }}
{{- end }}

{{/* Pod and container hardening shared by every workload. */}}
{{- define "sww.podSecurityContext" -}}
runAsNonRoot: true
runAsUser: 1001
runAsGroup: 1001
fsGroup: 1001
seccompProfile:
  type: RuntimeDefault
{{- end }}

{{- define "sww.containerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: false
capabilities:
  drop: ["ALL"]
{{- end }}
