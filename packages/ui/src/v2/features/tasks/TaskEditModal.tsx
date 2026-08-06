/**
 * Create or edit a task. All state and both write paths live in `use-task-form`;
 * this file is the dialog's shape.
 */
import { PlayIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@v2/components/ui/dialog';
import { Input } from '@v2/components/ui/input';
import { Label } from '@v2/components/ui/label';
import { Textarea } from '@v2/components/ui/textarea';
import type { Todo } from '@/lib/api/todos';
import { TaskAttachments } from './TaskAttachments';
import { TaskMetaFields } from './TaskMetaFields';
import { TaskSelectFields } from './TaskSelectFields';
import { useTaskForm } from './use-task-form';

interface ModalFooterProps {
  todo?: Todo | null;
  saving: boolean;
  canSave: boolean;
  onDelete: () => void;
  onClose: () => void;
  onStartSession?: (todoId: string) => void;
}

function ModalFooter({ todo, saving, canSave, onDelete, onClose, onStartSession }: ModalFooterProps) {
  return (
    <DialogFooter className="items-center">
      {todo && (
        <Button
          type="button"
          data-testid="tasks-edit-delete"
          aria-label="Delete task"
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive sm:mr-auto"
        >
          <Trash2Icon />
        </Button>
      )}
      {todo?.status === 'in_progress' && onStartSession && (
        <Button
          type="button"
          data-testid="tasks-edit-start"
          variant="secondary"
          onClick={() => {
            onStartSession(todo.id);
            onClose();
          }}
        >
          <PlayIcon />
          Start session
        </Button>
      )}
      <DialogClose asChild>
        <Button type="button" data-testid="tasks-edit-cancel" variant="outline">
          Cancel
        </Button>
      </DialogClose>
      <Button type="submit" data-testid="tasks-edit-save" disabled={!canSave || saving}>
        {saving ? 'Saving…' : todo ? 'Save changes' : 'Create task'}
      </Button>
    </DialogFooter>
  );
}

interface TaskEditModalProps {
  port: number;
  projectId: string;
  todo?: Todo | null;
  allTodos: Todo[];
  allLabels: string[];
  onClose: () => void;
  onStartSession?: (todoId: string) => void;
}

export function TaskEditModal({
  port,
  projectId,
  todo,
  allTodos,
  allLabels,
  onClose,
  onStartSession,
}: TaskEditModalProps) {
  const form = useTaskForm({ port, projectId, todo, onClose });
  const { fields, set } = form;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      {/* The dialog scrolls as one, the way stock does — a pinned header and
          footer would mean re-plumbing padding out of DialogContent again. */}
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{todo ? `Edit task #${todo.number}` : 'New task'}</DialogTitle>
          <DialogDescription>
            {todo ? 'Update this task and save when you are done.' : 'Add a task to this project.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.submit} className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tasks-edit-title">Title</Label>
              <Input
                id="tasks-edit-title"
                data-testid="tasks-edit-title"
                value={fields.title}
                onChange={(e) => set.title(e.target.value)}
                placeholder="Task title"
                autoFocus
                required
              />
            </div>

            <TaskSelectFields
              type={fields.type}
              onTypeChange={set.type}
              priority={fields.priority}
              onPriorityChange={set.priority}
              status={fields.status}
              onStatusChange={set.status}
            />

            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="tasks-edit-body">Description</Label>
                <span className="text-xs text-muted-foreground">Markdown — paste an image to attach</span>
              </div>
              <Textarea
                id="tasks-edit-body"
                data-testid="tasks-edit-body"
                rows={4}
                value={fields.body}
                onChange={(e) => set.body(e.target.value)}
                onPaste={(e) => void form.attachPasted(e)}
                placeholder="Describe the task…"
                // The stock textarea is field-sizing-content; uncapped, a long
                // brief pushes every field below it out of the dialog.
                className="max-h-64 resize-none"
              />
            </div>

            {form.attachErr && <p className="text-sm text-destructive">{form.attachErr}</p>}

            <TaskAttachments
              port={port}
              todoId={todo?.id}
              pending={form.pending}
              onPendingChange={form.setPending}
              onRejectFile={form.setAttachErr}
            />

            <TaskMetaFields
              labelList={fields.labelList}
              onLabelChange={set.labelList}
              allLabels={allLabels}
              assignees={fields.assignees}
              onAssigneesChange={set.assignees}
              milestone={fields.milestone}
              onMilestoneChange={set.milestone}
              dependencies={fields.dependencies}
              onDepsChange={set.dependencies}
              currentNumber={todo?.number}
              allTodos={allTodos}
            />
          </div>

          <ModalFooter
            todo={todo}
            saving={form.saving}
            canSave={fields.title.trim().length > 0}
            onDelete={() => void form.destroy()}
            onClose={onClose}
            onStartSession={onStartSession}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
